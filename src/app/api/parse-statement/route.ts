import { NextResponse } from "next/server";
import { validateFile } from "@/lib/upload";
import { extractPdfText } from "@/lib/pdf-extract";
import {
  SCANNED_PDF_WARNING,
  detectBalanceLine,
  extractMoneyValues,
  findDate,
  type ParseStatementResponse,
} from "@/lib/parser";
import { parseStatement } from "@/lib/statement-pipeline";
import {
  aiAssistConfig,
  isAiAssistEligible,
  resolveAiAssist,
  notAttemptedOutcome,
  type AiEvidence,
} from "@/lib/ai-assist";
import { selectVisionRegions, renderVisionEvidence, type VisionImage } from "@/lib/pdf-render";
import {
  FREE_PREVIEW_MAX_PAGES,
  FREE_PREVIEW_TRUNCATION_NOTICE,
} from "@/lib/free-preview";

// PDF parsing needs the Node runtime (unpdf / pdf.js is not Edge-compatible).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IS_DEV = process.env.NODE_ENV === "development";

// Below this much extractable text we assume the PDF is scanned/image-only.
const MIN_TEXT_LENGTH = 24;

function moneyString(value: number | null): string | null {
  return value === null ? null : value.toFixed(2);
}

function errorResponse(fileName: string, warning: string, status = 400) {
  const body: ParseStatementResponse = {
    ok: false,
    source: "real-parser",
    fileName,
    pageCount: null,
    statementKind: "unknown",
    layoutFamily: "unknown",
    rows: [],
    openingBalance: null,
    closingBalance: null,
    warnings: [warning],
  };
  return NextResponse.json(body, { status });
}

// PRIVACY: this handler must never persist the file or extracted text, and must
// never log statement text, rows, balances, account numbers, or descriptions.
// Only generic, non-sensitive messages may be logged.
// TODO(launch-blocker): finalize a production logging policy (structured logs,
// no PII, request ids only) and confirm the host does not retain request bodies.
export async function POST(request: Request): Promise<NextResponse> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse("", "The upload could not be read. Please try again.");
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return errorResponse("", "No PDF file was received.");
  }

  const fileName = file.name || "statement.pdf";
  const validation = validateFile(file);
  if (!validation.ok) {
    return errorResponse(fileName, validation.reason);
  }

  let extracted;
  let pdfBytes: Uint8Array | null = null;
  try {
    pdfBytes = new Uint8Array(await file.arrayBuffer());
    extracted = await extractPdfText(pdfBytes);
    // `pdfBytes` and `extracted` go out of scope when the request ends; nothing is
    // written to disk or a database. No caching of the file or its text.
  } catch {
    // Do not surface internal error details (may echo file contents).
    return errorResponse(
      fileName,
      "We couldn't read this PDF. It may be corrupted or password protected.",
      422,
    );
  }

  if (IS_DEV) console.log("[parse-statement] route reached", { pages: extracted.pageCount });

  // Little or no extractable text => almost certainly scanned/image-only.
  if (extracted.textLength < MIN_TEXT_LENGTH) {
    if (IS_DEV) console.log("[parse-statement] scanned/image-only (no AI)");
    const body: ParseStatementResponse = {
      ok: true,
      source: "real-parser",
      fileName,
      pageCount: extracted.pageCount,
      statementKind: "unknown",
      layoutFamily: "unknown",
      rows: [],
      openingBalance: null,
      closingBalance: null,
      warnings: [SCANNED_PDF_WARNING],
      // Always include aiAssist so the client/diagnostics can rely on it.
      aiAssist: notAttemptedOutcome(aiAssistConfig(), "not-eligible"),
    };
    return NextResponse.json(body);
  }

  // Free-preview page cap (stateless, per request). Process only the first N
  // pages; the 1-preview-per-6h interval and monthly quotas need accounts and are
  // NOT enforced here (see free-preview.ts TODO). This is honest free-preview
  // behavior, not abuse protection.
  const totalPages = extracted.pageCount ?? extracted.pages.length;
  const truncated = totalPages > FREE_PREVIEW_MAX_PAGES;
  const previewPages = truncated ? extracted.pages.slice(0, FREE_PREVIEW_MAX_PAGES) : extracted.pages;
  const previewItems = truncated
    ? extracted.items.filter((it) => it.page <= FREE_PREVIEW_MAX_PAGES)
    : extracted.items;

  // Run the explicit pipeline: extracted text + coordinate items → ParsedStatement
  // (model) → validation. Export/preview rows come from the model's transactions,
  // never from raw text. Items/text are used only here and are never returned to
  // the client, logged, or stored.
  const { statement, result, rows } = parseStatement({
    text: previewPages.join("\n"),
    items: previewItems,
    meta: { fileName, pageCount: extracted.pageCount ?? undefined },
  });

  // AI-assisted repair is a FALLBACK. `resolveAiAssist` is the single decision
  // function: it enforces eligibility + config, makes a REAL OpenAI call when both
  // hold, sanitizes + re-validates, adopts the repaired statement ONLY when it
  // improved/reconciled, and ALWAYS returns an outcome (so `aiAssist` is present
  // on every response). No prompt/response/key/rows are logged.
  // Build compact, safe AI evidence from deterministic detection: the balance
  // values found (the ONLY balances AI may use), the per-candidate parser
  // summaries, and transaction-region lines (lines with money + a date or two
  // money values — not legal/footer/marketing). Evidence is sent to the model
  // only; it is never logged or returned to the client.
  const previewLines = previewPages
    .join("\n")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const detectedBalances: number[] = [];
  for (const line of previewLines) {
    const b = detectBalanceLine(line);
    if (b) detectedBalances.push(b.value);
  }
  const regionLines = previewLines
    .filter((line) => {
      const moneys = extractMoneyValues(line);
      return moneys.length >= 2 || (moneys.length >= 1 && findDate(line) !== null);
    })
    .slice(0, 400);
  const candidateSummaries: AiEvidence["candidateSummaries"] = (
    result.parseStats?.candidateComparison ?? []
  ).map((c) => ({
    name: c.name,
    rowCount: c.rowCount,
    totalDebits: c.totalDebits,
    totalCredits: c.totalCredits,
    balanceStatus: c.balanceStatus,
    difference: c.balanceDiff,
  }));

  const aiConfig = aiAssistConfig();

  // Vision fallback: render targeted crops ONLY when the parser result needs help.
  // One multimodal call follows (never a separate text + vision call). Rendering is
  // best-effort and degrades to text-layout evidence with a safe failure reason.
  let visionImages: VisionImage[] = [];
  let renderFailedReason: string | null = null;
  if (pdfBytes && aiConfig.enabled && isAiAssistEligible(statement)) {
    const visionRequested = process.env.ENABLE_AI_VISION_FALLBACK !== "false";
    if (visionRequested && !aiConfig.visionModel) {
      renderFailedReason = "vision-model-not-configured";
    } else if (aiConfig.visionEnabled) {
      try {
        const hasLowConfidence =
          statement.validation.confidence < 0.7 ||
          statement.transactions.some((t) => t.confidence < 0.7);
        const regions = selectVisionRegions({ pageCount: previewPages.length, hasLowConfidence });
        const rendered = await renderVisionEvidence(pdfBytes, regions, { enabled: true });
        visionImages = rendered.images;
        if (!rendered.available) renderFailedReason = rendered.failureReason;
      } catch {
        // Never fail the conversion because rendering failed; degrade to text-layout.
        visionImages = [];
        renderFailedReason = "render-error";
      }
    }
  }

  const {
    statement: finalStatement,
    rows: finalRows,
    outcome: aiOutcome,
  } = await resolveAiAssist(
    statement,
    rows,
    aiConfig,
    { fileName, pageCount: extracted.pageCount ?? undefined },
    {
      evidence: { detectedBalances, regionLines, candidateSummaries },
      images: visionImages,
      renderFailedReason,
    },
  );

  // Safe dev-only trace of the decision path (no statement text/rows/key/prompt).
  if (IS_DEV) {
    console.log("[parse-statement] flow", {
      pagesProcessed: previewPages.length,
      truncated,
      validationStatus: finalStatement.validation.status,
      validationDifference: finalStatement.validation.difference ?? null,
      confidence: finalStatement.validation.confidence,
      aiEligible: aiOutcome.eligible,
      aiConfigured: aiOutcome.configured,
      aiEnabled: aiOutcome.enabled,
      aiAttempted: aiOutcome.attempted,
      aiCalled: aiOutcome.called,
      aiResponseReceived: aiOutcome.responseReceived,
      aiApplied: aiOutcome.applied,
      aiStatus: aiOutcome.status,
      aiErrorLabel: aiOutcome.errorLabel,
      aiMissingConfig: aiOutcome.missingConfig,
      aiIndependentCandidateBuilt: aiOutcome.aiIndependentCandidateBuilt,
      aiRepairPlanBuilt: aiOutcome.aiRepairPlanBuilt,
      adoptedCandidateSource: aiOutcome.adoptedCandidateSource,
      candidateComparisonCount: aiOutcome.candidateComparisonCount,
      aiRejectedReason: aiOutcome.aiRejectedReason,
      aiFallbackType: aiOutcome.aiFallbackType,
      aiCallCount: aiOutcome.aiCallCount,
      aiVisionUsed: aiOutcome.aiVisionUsed,
      aiRenderedPagesCount: aiOutcome.aiRenderedPagesCount,
      aiImageCropsCount: aiOutcome.aiImageCropsCount,
      aiFullPageImagesCount: aiOutcome.aiFullPageImagesCount,
      aiTotalTokenCount: aiOutcome.aiTotalTokenCount,
      aiProviderResponseId: aiOutcome.aiProviderResponseId,
      aiRenderFailedReason: aiOutcome.aiRenderFailedReason,
    });
  }

  const warnings = truncated
    ? [FREE_PREVIEW_TRUNCATION_NOTICE, ...result.warnings]
    : result.warnings;

  const body: ParseStatementResponse = {
    ok: true,
    source: "real-parser",
    fileName,
    pageCount: extracted.pageCount,
    statementKind: finalStatement.statementKind,
    layoutFamily: result.layoutFamily,
    rows: finalRows,
    openingBalance: moneyString(finalStatement.openingBalance ?? null),
    closingBalance: moneyString(finalStatement.closingBalance ?? null),
    warnings,
    creditCardStats: result.creditCardStats,
    parseStats: result.parseStats,
    validation: finalStatement.validation,
    aiAssist: aiOutcome,
  };

  return NextResponse.json(body);
}
