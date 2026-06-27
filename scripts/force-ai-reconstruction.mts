// DEV-ONLY forced AI full-reconstruction harness.
//
//   npm run ai:force -- <path-to-pdf>
//   node --experimental-strip-types scripts/force-ai-reconstruction.mts <path-to-pdf>
//
// Runs the normal parser first, then FORCES the AI full-reconstruction fallback to
// run EVEN IF the parser already verifies (which the app would normally skip). It
// reuses the exact same Blinders/evidence-selection/vision-render logic as the API
// route and rebuilds the AI result through the same canonical ParsedStatement +
// validation pipeline, then compares parser vs AI structurally.
//
// It makes ONE AI call. Requires OPENAI_API_KEY + AI_ASSIST_MODEL in the
// environment to actually call the model; otherwise it prints parser aggregates and
// a clear "AI not configured" note.
//
// PRIVACY: prints SAFE AGGREGATES ONLY — counts, statuses, balances, differences,
// token counts, timings. It NEVER prints transaction descriptions, row text, names,
// merchant names, account numbers, prompts, AI responses, OCR/PDF text, images, or
// base64. Nothing is written to disk.

import { readFileSync, existsSync } from "node:fs";
import { basename } from "node:path";
import { extractPdfText } from "../src/lib/pdf-extract-core.ts";
import { parseStatement } from "../src/lib/statement-pipeline.ts";
import { computeBalanceCheck } from "../src/lib/upload.ts";
import {
  detectBalanceLine,
  detectCreditCardInterestFees,
  extractMoneyValues,
  findDate,
  type InterestFeeDetection,
} from "../src/lib/parser.ts";
import {
  aiAssistConfig,
  resolveAiAssist,
  buildBlindersPacket,
  type AiEvidence,
  type BlindersPacket,
} from "../src/lib/ai-assist.ts";
import {
  planVisionEvidence,
  renderVisionEvidence,
  analyzeVisionPages,
  probeRenderBackend,
  type VisionImage,
  type VisionSelectionDiag,
  type EvidencePlanDiag,
} from "../src/lib/pdf-render.ts";
import { estimateAiCost, formatUsd } from "../src/lib/ai-cost.ts";

// Populate provider token meta so cost/token diagnostics are available (dev only).
process.env.AI_ASSIST_DEBUG_PROVIDER_META = "true";

const money = (n: number | null | undefined): string =>
  n === null || n === undefined ? "—" : n.toFixed(2);
const yn = (b: boolean | null | undefined): string => (b ? "yes" : "no");

/** Safe aggregate summary returned for reuse (e.g. the smoke runner). No content. */
export type ForcedSummary = {
  file: string;
  aiConfigured: boolean;
  parserRows: number;
  aiRows: number | null;
  aiDifference: number | null;
  aiReconciled: boolean;
  evidenceMode: string;
  inputImageCount: number | null;
  totalTokens: number | null;
  estimatedCost: string;
  verdict: string;
  error?: string;
};

/**
 * Run the forced AI reconstruction for one PDF and return a SAFE aggregate summary.
 * Prints the detailed (safe) report only when `verbose` (the CLI). Reused by the
 * smoke runner. Never prints/returns row text, descriptions, prompts, responses,
 * PDF text, images, or base64.
 */
export async function runForcedReconstruction(
  path: string,
  opts: { verbose?: boolean } = {},
): Promise<ForcedSummary> {
  const verbose = opts.verbose ?? true;
  const log = (s = ""): void => {
    if (verbose) console.log(s);
  };
  const line = (label: string, value: unknown): void => {
    if (verbose) console.log(`  ${label.padEnd(30)} ${value}`);
  };
  const fileName = basename(path);
  const t0 = Date.now();
  if (!existsSync(path)) {
    return { file: fileName, aiConfigured: false, parserRows: 0, aiRows: null, aiDifference: null, aiReconciled: false, evidenceMode: "none", inputImageCount: null, totalTokens: null, estimatedCost: "—", verdict: "file-not-found", error: "file-not-found" };
  }

  // ----- Stage A: extract (keep a pristine copy for the vision renderer) -----
  const raw = new Uint8Array(readFileSync(path));
  const pdfBytes = raw.slice();
  const extracted = await extractPdfText(raw);

  // ----- Parser-first (the source of truth) -----
  const { statement, result, rows } = parseStatement({
    text: extracted.pages.join("\n"),
    items: extracted.items,
    meta: { fileName: basename(path), pageCount: extracted.pageCount ?? undefined },
  });
  const mode = statement.statementKind === "credit-card" ? "credit-card" : "bank-account";
  const parserCheck = computeBalanceCheck(
    statement.openingBalance ?? null,
    statement.closingBalance ?? null,
    rows,
    mode,
  );

  log(`\n=== FORCED AI RECONSTRUCTION (dev harness) — ${fileName} ===`);
  log("\nParser result (source of truth):");
  line("statement kind", statement.statementKind);
  line("page count", extracted.pageCount ?? "—");
  line("row count", statement.transactions.length);
  line("opening balance", money(statement.openingBalance ?? null));
  line("closing balance", money(statement.closingBalance ?? null));
  line("total credits", money(parserCheck.totalCredits));
  line("total debits", money(parserCheck.totalDebits));
  line("validation status", statement.validation.status);
  line("reconciliation difference", money(statement.validation.difference ?? null));
  line("chosen candidate", result.parseStats?.candidate ?? "—");
  line("chosen source", result.parseStats?.chosenCandidateSource ?? "—");

  const config = aiAssistConfig();
  if (!config.enabled) {
    log("\nAI not configured (need OPENAI_API_KEY + AI_ASSIST_MODEL).");
    log("Parser aggregates printed above; skipping forced AI call.");
    log(`\nmissing config: ${config.missingConfig.join(", ") || "—"}`);
    return {
      file: fileName,
      aiConfigured: false,
      parserRows: statement.transactions.length,
      aiRows: null,
      aiDifference: null,
      aiReconciled: false,
      evidenceMode: "none",
      inputImageCount: null,
      totalTokens: null,
      estimatedCost: "—",
      verdict: "ai-not-configured",
    };
  }

  // ----- Build the SAME evidence the API route builds (safe primitives only) -----
  const previewLines = extracted.pages
    .join("\n")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const detectedBalances: number[] = [];
  for (const l of previewLines) {
    const b = detectBalanceLine(l);
    if (b) detectedBalances.push(b.value);
  }
  const regionLines = previewLines
    .filter((l) => {
      const m = extractMoneyValues(l);
      return m.length >= 2 || (m.length >= 1 && findDate(l) !== null);
    })
    .slice(0, 400);
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

  // ----- Vision evidence + Blinders (same selection logic as the route) -----
  let visionImages: VisionImage[] = [];
  let renderFailedReason: string | null = null;
  let visionSelection: VisionSelectionDiag | null = null;
  let evidencePlan: EvidencePlanDiag | null = null;
  let renderDurationMs: number | null = null;
  let blinders: BlindersPacket | null = null;
  try {
    await probeRenderBackend();
    const pageAnalysis = analyzeVisionPages(extracted.pages);
    // Render whole document pages as the default evidence (same planner as the route).
    const plan = planVisionEvidence({
      pageCount: extracted.pages.length,
      perPageText: extracted.pages,
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
    if (!rendered.available) renderFailedReason = rendered.failureReason;

    const blindersMode = statement.statementKind === "credit-card" ? "credit-card" : "bank-account";
    const residual = statement.validation.difference ?? null;
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
      parserFailureReasons: statement.validation.status === "passed" ? ["forced-dev-harness"] : ["validation-not-passed"],
      transactionTablePages: pageAnalysis.transactionHeaderPages,
      summaryPages: pageAnalysis.summaryPages,
      tableHeaderPages: pageAnalysis.transactionHeaderPages,
      visionEvidenceOrder: rendered.images.map((img) => ({ id: img.id, kind: img.kind, page: img.page })),
      parserContext: {
        rowCount: statement.transactions.length,
        totalCredits: Math.round(parserCheck.totalCredits * 100) / 100,
        totalDebits: Math.round(parserCheck.totalDebits * 100) / 100,
        confidence: statement.validation.confidence,
        validationStatus: statement.validation.status,
      },
      residual,
      likelyMissingDirection,
      expectedCredits: statement.summaryTotals?.totalCredits ?? null,
      expectedDebits: statement.summaryTotals?.totalDebits ?? null,
    });
  } catch {
    renderFailedReason = "render-error";
  }

  // ----- ONE forced AI call through the SAME resolve/validate/adopt pipeline -----
  const resolved = await resolveAiAssist(
    statement,
    rows,
    config,
    { fileName: basename(path), pageCount: extracted.pageCount ?? undefined },
    {
      evidence: { detectedBalances, regionLines, candidateSummaries, creditCardInterestFees, blinders },
      images: visionImages,
      renderFailedReason,
      visionSelection,
      evidencePlan,
      force: true, // DEV-ONLY: run AI even though the parser may already verify
    },
  );
  const o = resolved.outcome;
  const cost = estimateAiCost(config.model, o.aiInputTokenCount, o.aiOutputTokenCount, o.aiTotalTokenCount);

  log("\nForced AI full-reconstruction (one call):");
  line("ai mode", o.aiMode);
  line("ai called", yn(o.called));
  line("ai status", o.status);
  line("render failed reason", o.aiRenderFailedReason ?? "—");
  line("error label", o.errorLabel ?? "—");

  log("\nParser vs AI (structural, safe aggregates):");
  line("parserRows", o.parserRows ?? statement.transactions.length);
  line("aiRows", o.aiReconstructionRows ?? "—");
  line("parserDifference", money(o.parserDifference ?? statement.validation.difference ?? null));
  line("aiDifference", money(o.aiReconstructionDifference ?? null));
  line("aiReconciled", yn(o.aiReconciled));
  line("aiWouldBeAdoptedByNormalRules", yn(o.aiAdopted));
  line("aiAdoptedReason", o.aiAdoptedReason ?? "—");
  line("aiRejectedReason", o.aiRejectedReason ?? "—");
  line("droppedParserRowsCount", o.aiDroppedParserRowsCount ?? "—");
  line("addedRowsVsParserCount", o.aiAddedRowsVsParserCount ?? "—");
  line("correctedRowsVsParserCount", o.aiCorrectedRowsVsParserCount ?? "—");
  line("aggregateRowsDetected", o.aiAggregateRowsDetected);
  line("placeholderRowsDetected", o.aiPlaceholderRowsDetected);
  line("largestRowShareOfDebits", o.aiLargestRowShareOfDebits ?? "—");
  line("missingDateRate", o.aiMissingDateRate ?? "—");
  line("lowConfidenceRowRate", o.aiLowConfidenceRowRate ?? "—");

  const small = (extracted.pageCount ?? extracted.pages.length) <= 6;
  log("\nEvidence completeness (safe aggregates):");
  line("aiEvidenceMode", o.aiEvidenceMode);
  line("aiEvidenceCoverageLevel", o.aiEvidenceCoverageLevel);
  line("aiEvidenceCompletenessScore", o.aiEvidenceCompletenessScore ?? "—");
  line("selectedEvidencePages", (o.selectedEvidencePages ?? []).join(", ") || "—");
  line("selectedEvidencePageCount", o.selectedEvidencePageCount ?? "—");
  line("pageCoverageRatio", o.pageCoverageRatio ?? "—");
  line("allPagesSentForSmallPdf", small ? yn(o.allPagesFallbackUsed || (o.pageCoverageRatio ?? 0) >= 1) : "n/a (large pdf)");
  line("allLikelyTxPagesSent", yn((o.aiEvidenceCompletenessScore ?? 0) >= 1));
  line("transactionPagesSelected", (o.transactionPagesSelected ?? []).join(", ") || "—");
  line("summaryAnchorPagesSelected", (o.summaryAnchorPagesSelected ?? []).join(", ") || "—");
  line("pagesSkippedCount", o.pagesSkippedCount ?? "—");
  line("pagesSkippedReasonCounts", JSON.stringify(o.pagesSkippedReasonCounts ?? {}));
  line("aiIndependentEvidenceAvailable", yn(o.aiIndependentEvidenceAvailable));
  line("aiIndependentVisualReconstruction", yn(o.aiIndependentVisualReconstruction));
  line("aiFailureLikelyReason", o.aiFailureLikelyReason);
  line("regionSelectionFailedReason", o.regionSelectionFailedReason ?? "—");
  line("inputImageCount", o.aiInputImageCount ?? "—");
  line("parserRowsByPage", JSON.stringify(o.parserRowsByPage ?? {}));
  line("aiRowsByPage", JSON.stringify(o.aiRowsByPage ?? {}));
  line("droppedParserRowsCount", o.aiDroppedParserRowsCount ?? "—");
  line("inputTokens", o.aiInputTokenCount ?? "—");
  line("outputTokens", o.aiOutputTokenCount ?? "—");
  line("totalTokens", o.aiTotalTokenCount ?? "—");
  line("estimatedCost", cost.usd !== null ? formatUsd(cost.usd) : `unavailable (${cost.note})`);
  line("renderDurationMs", renderDurationMs ?? "—");
  line("aiCallDurationMs", o.aiCallDurationMs ?? "—");
  line("totalDurationMs", Date.now() - t0);

  // Evidence is "complete enough" when visual evidence was sent AND coverage is full.
  const evidenceComplete =
    o.aiIndependentEvidenceAvailable &&
    o.aiEvidenceCoverageLevel !== "partial" &&
    (o.aiEvidenceCompletenessScore === null || o.aiEvidenceCompletenessScore >= 1);

  let verdict: string;
  let verdictText: string;
  if (!o.aiIndependentEvidenceAvailable) {
    verdict = "not-a-valid-visual-test";
    verdictText =
      `  NOT A VALID VISUAL TEST: no visual evidence was sent (mode: ${o.aiEvidenceMode}, reason: ` +
      `${o.regionSelectionFailedReason ?? o.aiFailureLikelyReason}). A reconciled output here would only ` +
      `reflect text anchors, not independent reconstruction.`;
  } else if (o.aiIndependentVisualReconstruction && evidenceComplete) {
    verdict = "independent-visual-reconstruction-passed";
    verdictText = `  INDEPENDENT VISUAL RECONSTRUCTION PASSED (mode: ${o.aiEvidenceMode}, coverage: ${o.aiEvidenceCoverageLevel}, difference 0.00).`;
  } else if (!evidenceComplete) {
    verdict = "failed-incomplete-evidence";
    verdictText =
      `  FAILED BECAUSE EVIDENCE WAS INCOMPLETE (coverage: ${o.aiEvidenceCoverageLevel}, completeness: ` +
      `${o.aiEvidenceCompletenessScore ?? "—"}); not a fair model test (likely reason: ${o.aiFailureLikelyReason}).`;
  } else {
    verdict = "failed-complete-evidence";
    verdictText =
      `  INDEPENDENT VISUAL RECONSTRUCTION FAILED DESPITE COMPLETE EVIDENCE (mode: ${o.aiEvidenceMode}, ` +
      `aiDifference ${money(o.aiReconstructionDifference ?? null)}, likely reason: ${o.aiFailureLikelyReason}).`;
  }
  log("\nVerdict:");
  log(verdictText);
  log("");

  return {
    file: fileName,
    aiConfigured: true,
    parserRows: o.parserRows ?? statement.transactions.length,
    aiRows: o.aiReconstructionRows,
    aiDifference: o.aiReconstructionDifference,
    aiReconciled: o.aiReconciled,
    evidenceMode: o.aiEvidenceMode,
    inputImageCount: o.aiInputImageCount,
    totalTokens: o.aiTotalTokenCount,
    estimatedCost: cost.usd !== null ? formatUsd(cost.usd) : `unavailable`,
    verdict,
  };
}

// CLI entry: run for the single PDF path argument (verbose detailed report).
async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: node --experimental-strip-types scripts/force-ai-reconstruction.mts <path-to-pdf>");
    process.exit(2);
  }
  await runForcedReconstruction(path, { verbose: true });
}

// Only run the CLI when invoked directly (so the smoke runner can import the fn).
const invokedDirectly =
  process.argv[1] !== undefined && /force-ai-reconstruction\.mts$/.test(process.argv[1]);
if (invokedDirectly) {
  main().catch((err) => {
    // Never echo internals that could contain content; print a safe label only.
    const label = err instanceof Error ? err.name : "error";
    console.error(`force-ai-reconstruction failed (${label}).`);
    process.exit(1);
  });
}
