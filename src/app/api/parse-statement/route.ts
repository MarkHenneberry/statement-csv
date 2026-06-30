import { NextResponse } from "next/server";
import { validateFile, MAX_PDF_PAGES } from "@/lib/upload";
import { extractPdfText } from "@/lib/pdf-extract";
import {
  SCANNED_PDF_WARNING,
  detectBalanceLine,
  detectCreditCardInterestFees,
  extractMoneyValues,
  findDate,
  type ParseStatementResponse,
} from "@/lib/parser";
import { parseStatement } from "@/lib/statement-pipeline";
import {
  aiAssistConfig,
  isAiAssistEligible,
  resolveAiAssist,
  repairCreditCardInterestFees,
  buildBlindersPacket,
  notAttemptedOutcome,
  type AiEvidence,
  type VisionSelectionDiag,
  type InterestFeeDetection,
  type BlindersPacket,
} from "@/lib/ai-assist";
import { parsedStatementToRows } from "@/lib/statement-model";
import { buildSafeParseSummary } from "@/lib/parser-diagnostics";
import {
  planVisionEvidence,
  renderVisionEvidence,
  analyzeVisionPages,
  probeRenderBackend,
  type VisionImage,
  type VisionImageMeta,
  type VisionRegion,
  type EvidencePlanDiag,
} from "@/lib/pdf-render";
import { analyzePreviewLimit } from "@/lib/free-preview";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { ensureAppAccount } from "@/lib/billing/account";
import {
  evaluateAccountAccess,
  effectiveRemainingPages,
  effectiveMonthlyAllowance,
  isInternalTesterUser,
  getInternalTesterAllowance,
  getPreviewLimits,
} from "@/lib/billing/credits";
import { createConversionRecord } from "@/lib/billing/repo";
import { chargeVerifiedConversion } from "@/lib/billing/charge";
import {
  resolvePreviewSubject,
  evaluatePreviewQuota,
  recordPreviewAttempt,
  recordPreviewPageUsage,
  type PreviewSubject,
} from "@/lib/billing/free-preview-quota";
import type { BalanceStatus, ConversionStatus } from "@/lib/billing/types";

// PDF parsing needs the Node runtime (unpdf / pdf.js is not Edge-compatible).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Upper bound on a single conversion (parser + optional vision/AI fallback). Caps
// runaway work and matches the platform function limit; tune per hosting plan.
export const maxDuration = 60;

const IS_DEV = process.env.NODE_ENV === "development";

// Below this much extractable text we assume the PDF is scanned/image-only.
const MIN_TEXT_LENGTH = 24;

function moneyString(value: number | null): string | null {
  return value === null ? null : value.toFixed(2);
}

// Optional local-DEV-only debug aid (AI_VISION_DEBUG_SAVE_CROPS=true AND
// NODE_ENV=development): persist the rendered vision crops so a developer can
// confirm the RIGHT regions were sent. This is the ONLY path in the app that writes
// statement-derived bytes to disk; it is hard-gated to development so rendered
// statement images can never be written on the production server even if the flag
// is set. Filenames carry only region kind/page/band + pixel dimensions — never
// statement text, balances, names, or account data. Folder is gitignored.
async function saveVisionCropsForDebug(images: VisionImage[], regions: VisionRegion[]): Promise<void> {
  if (!IS_DEV || images.length === 0) return;
  try {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const dir = "private-debug/vision-crops";
    await mkdir(dir, { recursive: true });
    const pngDims = (buf: Buffer): string => {
      // PNG IHDR width/height live at byte offsets 16 and 20 (big-endian uint32).
      if (buf.length < 24) return "unknown";
      return `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;
    };
    const stamp = Date.now();
    for (const img of images) {
      const b64 = img.dataUrl.split(",")[1] ?? "";
      if (!b64) continue;
      const buf = Buffer.from(b64, "base64");
      const safeId = img.id.replace(/[^a-z0-9-]/gi, "_");
      const tag = img.crop ? "crop" : "fullpage";
      await writeFile(`${dir}/${stamp}-${safeId}-${tag}-${pngDims(buf)}.png`, buf);
    }
    if (IS_DEV) {
      console.log("[parse-statement] saved vision crops (debug)", {
        savedCount: images.length,
        regionCount: regions.length,
      });
    }
  } catch {
    // Debug aid only — never affect the response if saving fails.
  }
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
    previewLimited: false,
    pagesProcessed: 0,
  };
  return NextResponse.json(body, { status });
}

// Billing gate response (auth / page-credit blocks). Carries a safe `billingError`
// code so the client can route the user to sign in or upgrade. No statement content.
function billingErrorResponse(
  fileName: string,
  code: NonNullable<ParseStatementResponse["billingError"]>,
  message: string,
  status: number,
  pageCount: number | null = null,
  previewBlock?: ParseStatementResponse["previewBlock"],
) {
  const body: ParseStatementResponse = {
    ok: false,
    source: "real-parser",
    fileName,
    pageCount,
    statementKind: "unknown",
    layoutFamily: "unknown",
    rows: [],
    openingBalance: null,
    closingBalance: null,
    warnings: [message],
    previewLimited: false,
    pagesProcessed: 0,
    billingError: code,
    previewBlock,
  };
  return NextResponse.json(body, { status });
}

// Map the validation status to the safe BalanceStatus enum stored on a Conversion.
function toBalanceStatus(status: string): BalanceStatus {
  if (status === "passed") return "passed";
  if (status === "limited") return "limited";
  return "review";
}

// PRIVACY: this handler must never persist the file or extracted text, and must
// never log statement text, rows, balances, account numbers, or descriptions.
// Only generic, non-sensitive messages may be logged.
// TODO(launch-blocker): finalize a production logging policy (structured logs,
// no PII, request ids only) and confirm the host does not retain request bodies.
export async function POST(request: Request): Promise<NextResponse> {
  const routeStart = Date.now();
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

  // ----- Identify the caller (optional) BEFORE any work -----
  // Auth is OPTIONAL: signed-out visitors get the free preview quota; signed-in
  // users get their paid BillingAccount credits if they have an allowance, else the
  // same free preview. Auth state is read server-side only — the client cannot
  // claim paid/free status, choose a subject, or set the page count.
  const authUser = await getAuthenticatedUser();
  let account: Awaited<ReturnType<typeof ensureAppAccount>>["account"] | null = null;
  if (authUser) {
    try {
      account = (await ensureAppAccount(authUser)).account;
    } catch {
      return billingErrorResponse(
        fileName,
        "BILLING_ACCOUNT_NOT_FOUND",
        "We couldn't load your account. Please try again.",
        500,
      );
    }
  }

  // Internal-tester mode (server-side, env-driven only). The allowlist is matched
  // against the VALIDATED Supabase email — never a client-supplied value. Testers
  // get a high effective allowance and use the normal paid path (conversion record +
  // idempotent charge + usage tracking), but never create Stripe subscriptions.
  const internalTester = authUser != null && isInternalTesterUser(authUser.email);
  const testerAllowance = internalTester ? getInternalTesterAllowance() : 0;
  const testerOpts = { internalTester, testerAllowance };
  // Effective allowance passed to the charge helpers so a tester (whose stored plan
  // allowance is 0) is not blocked. undefined for normal accounts (no behavior change).
  const chargeAllowance =
    account && internalTester ? effectiveMonthlyAllowance(account, testerOpts) : undefined;

  let extracted;
  let pdfBytes: Uint8Array | null = null;
  try {
    const raw = new Uint8Array(await file.arrayBuffer());
    // Keep a pristine copy for the vision renderer BEFORE extraction: the PDF
    // extractor transfers (detaches) the underlying ArrayBuffer to the pdf.js
    // worker, after which the same bytes can no longer be rendered. Without this
    // snapshot the vision fallback always failed with a render error and never saw
    // the transaction pages.
    pdfBytes = raw.slice();
    extracted = await extractPdfText(raw);
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

  // The page count is derived server-side from the extracted PDF; the client cannot
  // supply or influence it.
  const pdfPageCount = extracted.pageCount ?? extracted.pages.length;

  // ----- Safety cap: reject pathologically large PDFs BEFORE parser/AI -----
  // Bounds per-request work regardless of plan. Clean message; no parser/AI runs.
  if (pdfPageCount > MAX_PDF_PAGES) {
    return errorResponse(
      fileName,
      `This PDF has ${pdfPageCount} pages, which is over the ${MAX_PDF_PAGES}-page limit. Please split it (for example, one statement or account at a time) and try again.`,
      413,
    );
  }

  // ----- Quota gate: block BEFORE the parser/AI run -----
  // Paid accounts (allowance > 0) and internal testers use BillingAccount credits;
  // everyone else (signed-out OR signed-in free) uses the free-preview quota. Neither
  // path runs the parser/AI until the gate passes.
  const isPaid = account != null && effectiveMonthlyAllowance(account, testerOpts) > 0;
  const billingMode: "paid" | "preview" = isPaid ? "paid" : "preview";

  // Preview-mode state captured at gate time (set only when billingMode==="preview").
  let previewSubject: PreviewSubject | null = null;
  let previewRemainingBefore: number | null = null;

  if (billingMode === "paid") {
    const access = evaluateAccountAccess(account!, pdfPageCount, testerOpts);
    if (!access.allowed) {
      const message =
        access.code === "PLAN_REQUIRED"
          ? "Your account has no monthly page credits. Choose a plan to convert statements."
          : `Not enough page credits: this statement needs ${access.required} page(s) and you have ${access.remaining} remaining. Upgrade or wait for your next billing period.`;
      return billingErrorResponse(fileName, access.code, message, 402, pdfPageCount);
    }
  } else {
    previewSubject = await resolvePreviewSubject(authUser?.id ?? null);
    const limits = getPreviewLimits();
    const decision = await evaluatePreviewQuota(previewSubject.subjectHash, pdfPageCount);
    previewRemainingBefore = decision.remaining;
    if (!decision.allowed) {
      const signedIn = authUser != null;
      const message =
        decision.code === "PREVIEW_ATTEMPT_LIMIT"
          ? `You've reached the free preview limit of ${limits.maxAttempts} conversions per ${limits.windowHours} hours. ${signedIn ? "Choose a plan to keep converting." : "Create an account or choose a plan to keep converting."}`
          : `Free preview used: this statement needs ${decision.required} page(s) and you have ${decision.remaining} free preview page(s) left in this ${limits.windowHours}-hour window. ${signedIn ? "Choose a plan to convert more." : "Create an account or choose a plan to convert more."}`;
      return billingErrorResponse(fileName, "PREVIEW_LIMIT", message, 402, pdfPageCount, {
        signedIn,
        remaining: decision.remaining,
        required: decision.required,
        windowHours: limits.windowHours,
      });
    }
    // Count an attempt up front so even a failed/empty parse consumes one (abuse
    // guard). Best-effort: a tracking hiccup must not break the conversion.
    await recordPreviewAttempt(previewSubject.subjectHash, previewSubject.subjectType).catch(() => {});
  }

  // Little or no extractable text => almost certainly scanned/image-only. The gate
  // passed, but extraction failed, so this is a FAILED conversion that consumes 0
  // pages (paid: 0-credit Conversion record; preview: no row, attempt already counted).
  if (extracted.textLength < MIN_TEXT_LENGTH) {
    if (IS_DEV) console.log("[parse-statement] scanned/image-only (no AI)");
    let failedBilling: ParseStatementResponse["billing"] | undefined;
    if (billingMode === "paid" && account) {
      const conv = await createConversionRecord({
        userId: authUser!.id,
        pageCount: pdfPageCount,
        status: "failed",
        balanceStatus: null,
        creditsCharged: 0,
      }).catch(() => null);
      failedBilling = conv
        ? {
            mode: "paid",
            conversionId: conv.id,
            status: "failed",
            charged: false,
            chargedPages: 0,
            pagesRemaining: effectiveRemainingPages(account, testerOpts),
          }
        : undefined;
    } else {
      failedBilling = {
        mode: "preview",
        status: "failed",
        charged: false,
        chargedPages: 0,
        pagesRemaining: previewRemainingBefore,
      };
    }
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
      previewLimited: false,
      pagesProcessed: 0,
      runtimeEnv: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
      // Always include aiAssist so the client/diagnostics can rely on it.
      aiAssist: notAttemptedOutcome(aiAssistConfig(), "not-eligible"),
      billing: failedBilling,
    };
    return NextResponse.json(body);
  }

  // Authenticated + credit-checked: process the FULL document. Page credits (not a
  // preview cap) govern how much a user may convert, so nothing is truncated here.
  const previewPages = extracted.pages;
  const previewItems = extracted.items;
  const previewAnalysis = analyzePreviewLimit(extracted.pages, previewPages.length);
  const truncated = false;

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
  // Detect current-period credit-card interest/fees so the model includes them and
  // a deterministic step can close a debit shortfall that is exactly that amount.
  const creditCardInterestFees: InterestFeeDetection | null =
    statement.statementKind === "credit-card" ? detectCreditCardInterestFees(previewLines) : null;
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
  let visionSelection: VisionSelectionDiag | null = null;
  let evidencePlan: EvidencePlanDiag | null = null;
  let renderDurationMs: number | null = null;
  let rendererBackendAvailable: boolean | null = null;
  let rendererBackendName: string | null = null;
  let rendererProbeReason: string | null = null;
  let visionEvidenceMeta: VisionImageMeta[] = [];
  let blinders: BlindersPacket | null = null;
  if (pdfBytes && aiConfig.enabled && isAiAssistEligible(statement)) {
    const visionRequested = process.env.ENABLE_AI_VISION_FALLBACK !== "false";
    if (visionRequested && !aiConfig.visionModel) {
      renderFailedReason = "vision-model-not-configured";
    } else if (aiConfig.visionEnabled) {
      try {
        // Probe the native image-render backend so production can SEE whether
        // @napi-rs/canvas + the PDF renderer are available in this runtime (the
        // most likely reason vision silently degrades to a text-layout call on a
        // serverless host). Safe labels only — no stack traces.
        const probe = await probeRenderBackend();
        rendererBackendAvailable = probe.available;
        rendererBackendName = probe.backend;
        rendererProbeReason = probe.reason;
        // Classify preview pages (kept for Blinders page hints).
        const pageAnalysis = analyzeVisionPages(previewPages);
        // EVIDENCE STRATEGY: render whole document pages so the model can parse the
        // statement itself — full pages by default (small PDFs send everything when
        // uncertain), transaction + anchor pages for large PDFs. Transaction density
        // beats footer/legal classification, so a rows+footer page is never dropped.
        const plan = planVisionEvidence({
          pageCount: previewPages.length,
          perPageText: previewPages,
          maxImages: 12,
        });
        const regions = plan.regions;
        evidencePlan = plan.diag;
        visionSelection = {
          selectedPageIndexes: plan.diag.selectedEvidencePages,
          selectedRegionKinds: [...new Set(regions.map((r) => r.kind))],
          selectedRegionCount: regions.length,
          transactionHeaderPagesDetected: pageAnalysis.transactionHeaderPages.length,
          summaryPagesDetected: pageAnalysis.summaryPages.length,
          excludedLegalPagesCount: pageAnalysis.legalPages.length,
          excludedWarningRewardPagesCount: pageAnalysis.warningRewardPages.length,
        };
        const renderStart = Date.now();
        const rendered = await renderVisionEvidence(pdfBytes, regions, { enabled: true, maxImages: 12 });
        renderDurationMs = Date.now() - renderStart;
        visionImages = rendered.images;
        visionEvidenceMeta = rendered.meta;
        if (!rendered.available) renderFailedReason = rendered.failureReason;
        if (process.env.AI_VISION_DEBUG_SAVE_CROPS === "true") {
          await saveVisionCropsForDebug(rendered.images, regions);
        }
        // Blinders: guide the model to the itemized table and supply parser context +
        // residual as LOOSENED guidance (context/clues, not truth or tunnel vision).
        // Summary totals are TEXT anchors (never images) used only for validation.
        const blindersMode = statement.statementKind === "credit-card" ? "credit-card" : "bank-account";
        const parserDebitsTotal =
          Math.round(statement.transactions.reduce((a, t) => a + (t.debit ?? 0), 0) * 100) / 100;
        const parserCreditsTotal =
          Math.round(statement.transactions.reduce((a, t) => a + (t.credit ?? 0), 0) * 100) / 100;
        const residual = statement.validation.difference ?? null;
        // Balance identity → which side of activity the residual implies is missing.
        let likelyMissingDirection: "debit" | "credit" | "either" | null = null;
        if (residual !== null && Math.abs(residual) >= 0.01) {
          likelyMissingDirection =
            blindersMode === "credit-card"
              ? residual > 0 ? "credit" : "debit"
              : residual > 0 ? "debit" : "credit";
        }
        blinders = buildBlindersPacket({
          statementKind: statement.statementKind,
          balanceMode: blindersMode,
          openingAnchor: statement.openingBalance ?? null,
          closingAnchor: statement.closingBalance ?? null,
          totalCreditsTarget: statement.summaryTotals?.totalCredits ?? null,
          totalDebitsTarget: statement.summaryTotals?.totalDebits ?? null,
          period: { start: statement.periodStart ?? null, end: statement.periodEnd ?? null },
          parserFailureReasons: statement.validation.status === "passed" ? [] : ["validation-not-passed"],
          transactionTablePages: pageAnalysis.transactionHeaderPages,
          summaryPages: pageAnalysis.summaryPages,
          tableHeaderPages: pageAnalysis.transactionHeaderPages,
          visionEvidenceOrder: rendered.images.map((img) => ({ id: img.id, kind: img.kind, page: img.page })),
          parserContext: {
            rowCount: statement.transactions.length,
            totalCredits: parserCreditsTotal,
            totalDebits: parserDebitsTotal,
            confidence: statement.validation.confidence,
            validationStatus: statement.validation.status,
          },
          residual,
          likelyMissingDirection,
          expectedCredits: statement.summaryTotals?.totalCredits ?? null,
          expectedDebits: statement.summaryTotals?.totalDebits ?? null,
        });
      } catch {
        // Never fail the conversion because rendering failed; degrade to text-layout.
        visionImages = [];
        renderFailedReason = "render-error";
      }
    }
  }

  const resolved = await resolveAiAssist(
    statement,
    rows,
    aiConfig,
    { fileName, pageCount: extracted.pageCount ?? undefined },
    {
      evidence: { detectedBalances, regionLines, candidateSummaries, creditCardInterestFees, blinders },
      images: visionImages,
      renderFailedReason,
      visionSelection,
      evidencePlan,
    },
  );
  let finalStatement = resolved.statement;
  let finalRows = resolved.rows;
  const aiOutcome = resolved.outcome;
  // Safe per-image vision evidence metadata (no pixels/text/base64) for diagnostics.
  aiOutcome.aiVisionEvidence = visionEvidenceMeta;

  // Deterministic interest/fee repair for the non-AI path: when AI did not replace
  // the statement (disabled/not adopted) but the parser captured the table and is
  // short only by the detected current-period interest/fees, close that gap from
  // real evidence and revalidate. Idempotent — a no-op when already reconciled.
  if (aiOutcome.adoptedCandidateSource === "parser" && creditCardInterestFees) {
    const rep = repairCreditCardInterestFees(
      finalStatement,
      creditCardInterestFees,
      { fileName, pageCount: extracted.pageCount ?? undefined },
    );
    if (rep.applied) {
      finalStatement = rep.statement;
      finalRows = parsedStatementToRows(rep.statement);
      aiOutcome.interestFeeRepairApplied = true;
      aiOutcome.interestFeeRowsAdded = rep.rowsAdded;
    }
  }

  // Surface safe performance diagnostics on the outcome (dev panel reads these).
  aiOutcome.renderDurationMs = renderDurationMs;
  aiOutcome.routeDurationMs = Date.now() - routeStart;
  aiOutcome.rendererBackendAvailable = rendererBackendAvailable;
  aiOutcome.rendererBackendName = rendererBackendName;
  aiOutcome.rendererProbeReason = rendererProbeReason;

  // PRODUCTION-SAFE one-line summary (gated by SERVER_SAFE_PARSE_TRACE) so Vercel
  // logs can reveal the vision path without exposing any statement content. This
  // works in production, unlike the IS_DEV trace. SAFE AGGREGATES ONLY.
  if (process.env.SERVER_SAFE_PARSE_TRACE === "true") {
    console.log(
      "[parse-statement-safe-summary]",
      JSON.stringify(
        buildSafeParseSummary({
          validationStatus: finalStatement.validation.status,
          confidence: finalStatement.validation.confidence,
          previewLimited: truncated,
          outcome: aiOutcome,
        }),
      ),
    );
  }

  // Safe dev-only trace of the decision path (no statement text/rows/key/prompt).
  if (IS_DEV) {
    console.log("[parse-statement] flow", {
      pagesProcessed: previewPages.length,
      truncated,
      validationStatus: finalStatement.validation.status,
      validationDifference: finalStatement.validation.difference ?? null,
      confidence: finalStatement.validation.confidence,
      previewLimited: truncated,
      previewLimitedReason: previewAnalysis.previewLimitedReason,
      meaningfulPagesDetected: previewAnalysis.meaningfulPagesDetected,
      skippedMeaningfulPagesCount: previewAnalysis.skippedMeaningfulPagesCount,
      aiEligible: aiOutcome.eligible,
      aiEligibilityReasons: aiOutcome.aiEligibilityReasons,
      aiSkippedReason: aiOutcome.aiSkippedReason,
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
      aiCandidateQualityStatus: aiOutcome.aiCandidateQualityStatus,
      aiCandidateRejectedForQuality: aiOutcome.aiCandidateRejectedForQuality,
      aiCandidateQualityReasons: aiOutcome.aiCandidateQualityReasons,
      aiFallbackType: aiOutcome.aiFallbackType,
      aiCallCount: aiOutcome.aiCallCount,
      aiVisionUsed: aiOutcome.aiVisionUsed,
      aiRenderedPagesCount: aiOutcome.aiRenderedPagesCount,
      aiImageCropsCount: aiOutcome.aiImageCropsCount,
      aiFullPageImagesCount: aiOutcome.aiFullPageImagesCount,
      aiTotalTokenCount: aiOutcome.aiTotalTokenCount,
      aiProviderResponseId: aiOutcome.aiProviderResponseId,
      aiRenderFailedReason: aiOutcome.aiRenderFailedReason,
      visionSelection: aiOutcome.visionSelection,
      interestFeeRepairApplied: aiOutcome.interestFeeRepairApplied,
      interestFeeRowsAdded: aiOutcome.interestFeeRowsAdded,
      // Performance diagnostics (safe; no content).
      renderDurationMs,
      aiCallDurationMs: aiOutcome.aiCallDurationMs,
      imageCount: visionImages.length,
      fullPageImageCount: aiOutcome.aiFullPageImagesCount,
      tokenCount: aiOutcome.aiTotalTokenCount,
      routeDurationMs: Date.now() - routeStart,
    });
  }

  const warnings = result.warnings;

  // ----- Billing: consume credits/quota for the result -----
  // verified = balance-checked; usable = at least one extracted row; failed = neither.
  const verified = finalStatement.validation.status === "passed";
  const usable = finalRows.length > 0;
  const convStatus: ConversionStatus = verified ? "verified" : usable ? "review" : "failed";
  let billing: ParseStatementResponse["billing"] | undefined;
  if (billingMode === "paid" && account) {
    // PAID: record a Conversion; charge verified immediately, review on export,
    // failed/none charge 0. (Unchanged paid policy.)
    try {
      const conv = await createConversionRecord({
        userId: authUser!.id,
        pageCount: pdfPageCount,
        status: convStatus,
        balanceStatus: toBalanceStatus(finalStatement.validation.status),
        creditsCharged: 0,
      });
      if (convStatus === "verified") {
        const charge = await chargeVerifiedConversion(conv.id, authUser!.id, chargeAllowance);
        billing = {
          mode: "paid",
          conversionId: conv.id,
          status: "verified",
          charged: charge.ok,
          chargedPages: charge.ok ? charge.chargedPages : 0,
          pagesRemaining: charge.ok ? charge.pagesRemaining : effectiveRemainingPages(account, testerOpts),
        };
      } else {
        billing = {
          mode: "paid",
          conversionId: conv.id,
          status: convStatus,
          charged: false,
          chargedPages: 0,
          pagesRemaining: effectiveRemainingPages(account, testerOpts),
          requiredPages: pdfPageCount,
        };
      }
    } catch {
      // A billing/DB hiccup must not corrupt the parse result the user sees.
      billing = undefined;
    }
  } else if (previewSubject) {
    // PREVIEW: no Conversion row and no PageCreditLedger/BillingAccount change.
    // A verified OR review-usable result consumes the PDF page count from the
    // free-preview quota immediately (review pages are NOT deferred to export here,
    // which keeps anonymous preview simple and prevents repeated unpaid parses).
    // A failed/empty result consumes 0 pages (the attempt was already counted).
    const consume = verified || usable ? pdfPageCount : 0;
    if (consume > 0) {
      await recordPreviewPageUsage(previewSubject.subjectHash, previewSubject.subjectType, consume).catch(() => {});
    }
    const remainingAfter =
      previewRemainingBefore !== null ? Math.max(0, previewRemainingBefore - consume) : null;
    billing = {
      mode: "preview",
      status: convStatus,
      charged: consume > 0,
      chargedPages: consume,
      pagesRemaining: remainingAfter,
      requiredPages: pdfPageCount,
    };
  }

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
    previewLimited: truncated,
    pagesProcessed: previewPages.length,
    meaningfulPagesDetected: previewAnalysis.meaningfulPagesDetected,
    skippedMeaningfulPagesCount: previewAnalysis.skippedMeaningfulPagesCount,
    previewLimitedReason: previewAnalysis.previewLimitedReason,
    runtimeEnv: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
    creditCardStats: result.creditCardStats,
    parseStats: result.parseStats,
    validation: finalStatement.validation,
    aiAssist: aiOutcome,
    billing,
  };

  return NextResponse.json(body);
}
