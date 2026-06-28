// AI Assist v2 — AI as an INDEPENDENT CANDIDATE GENERATOR, never the primary
// parser and never an unchecked row-overwrite layer.
//
// Pipeline position:
//   PDF → deterministic/coordinate/text parser → ParsedStatement → validation →
//   [if validation fails / low confidence AND AI configured]:
//     AI returns (A) an independent ParsedStatement candidate and/or
//                (B) a structured repair plan
//     → the app builds candidate ParsedStatements from AI output
//     → the SAME validation engine compares parser vs AI candidates
//     → adopt the AI candidate ONLY if it reconciles or materially improves
//   → review table → CSV/Excel export
//
// SAFEGUARDS: AI may only use opening/closing balances that already exist in the
// deterministically-detected evidence; AI-added rows are sanitized and the whole
// result must re-validate; AI never bypasses validation; a worse/equal AI result
// is rejected and the parser result is kept (status no-improvement).
//
// PRIVACY: compact parsed rows + detected balances + transaction-region evidence
// are sent to the model (that is the feature). Raw full-document text, legal/
// footer/marketing/remittance text, names, and keys are NOT sent, and NOTHING
// (prompt, response, key, rows) is ever logged or placed in diagnostics.
//
// Uses fetch (no SDK dependency). The HTTP call reads the key from process.env at
// call time and must only run server-side (the API route is runtime "nodejs").

import {
  LOW_CONFIDENCE_THRESHOLD,
  AGGREGATE_DESC_RE,
  PLACEHOLDER_DESC_RE,
} from "./upload.ts";
import {
  buildStatementFromRows,
  parsedStatementToRows,
  transactionToRow,
  type ParsedStatement,
  type Transaction,
  type SummaryTotals,
  type BuildStatementMeta,
} from "./statement-model.ts";
import type { StatementKind } from "./parser.ts";
import type { TransactionRow } from "./upload.ts";
import type {
  VisionImage,
  VisionImageMeta,
  AiEvidenceMode,
  AiEvidenceCoverageLevel,
  EvidencePlanDiag,
} from "./pdf-render.ts";

export type AiAssistConfig = {
  enabled: boolean;
  model: string | null;
  hasKey: boolean;
  missingConfig: string[];
  /** Vision fallback enabled (capability flag; usage still gated by eligibility). */
  visionEnabled: boolean;
  /** Vision-capable model (AI_VISION_MODEL, falling back to AI_ASSIST_MODEL). */
  visionModel: string | null;
  /** Expose safe provider/token metadata in dev diagnostics. */
  debugProviderMeta: boolean;
};

export type AiAssistStatus =
  | "not-eligible"
  | "disabled"
  | "not-configured"
  | "attempted"
  | "call-failed"
  | "invalid-response"
  | "no-usable-result"
  | "no-improvement"
  | "improved"
  | "reconciled";

export type AdoptedCandidateSource = "parser" | "ai-candidate" | "ai-repair-plan";

export type AiAssistOutcome = {
  eligible: boolean;
  configured: boolean;
  enabled: boolean;
  attempted: boolean;
  called: boolean;
  responseReceived: boolean;
  applied: boolean;
  improved: boolean;
  status: AiAssistStatus;
  model: string | null;
  missingConfig: string[];
  preDifference: number | null;
  postDifference: number | null;
  improvement: number | null;
  errorLabel: string | null;
  // --- candidate-comparison diagnostics (safe aggregates) ---
  aiIndependentCandidateBuilt: boolean;
  aiRepairPlanBuilt: boolean;
  aiCandidateDifference: number | null;
  aiRepairPlanDifference: number | null;
  adoptedCandidateSource: AdoptedCandidateSource;
  aiSelectedSectionIndex: number | null;
  aiRejectedReason: string | null;
  candidateComparisonCount: number;
  // --- vision fallback diagnostics (safe aggregates only) ---
  aiFallbackType: "none" | "text-layout" | "vision";
  aiCallCount: number;
  aiVisionUsed: boolean;
  aiRenderedPagesCount: number;
  aiImageCropsCount: number;
  aiFullPageImagesCount: number;
  aiInputTokenCount: number | null;
  aiOutputTokenCount: number | null;
  aiTotalTokenCount: number | null;
  aiProviderResponseId: string | null;
  /** Why vision rendering produced no images (safe label), if applicable. */
  aiRenderFailedReason: string | null;
  /** Safe aggregate vision page/region selection diagnostics. */
  visionSelection: VisionSelectionDiag | null;
  /** Wall-clock duration of the single AI call (ms), when measured. */
  aiCallDurationMs: number | null;
  /** Wall-clock duration of vision rendering (ms), set by the route when measured. */
  renderDurationMs: number | null;
  /** Wall-clock duration of the whole parse route (ms), set by the route. */
  routeDurationMs: number | null;
  /** A deterministic credit-card interest/fee repair was applied to the result. */
  interestFeeRepairApplied: boolean;
  /** Number of interest/fee rows added by the repair. */
  interestFeeRowsAdded: number;
  /** Safe labels for why AI was (or could be) run. Empty when verified. */
  aiEligibilityReasons: string[];
  /** Safe label for why AI was skipped (null when it ran/was eligible). */
  aiSkippedReason: string | null;
  /** Server-side image renderer backend probe (set by the route). null = not probed. */
  rendererBackendAvailable: boolean | null;
  /** Safe backend name (e.g. "@napi-rs/canvas") or null. */
  rendererBackendName: string | null;
  /** Safe label for why the renderer backend was unavailable, if probed. */
  rendererProbeReason: string | null;
  // --- AI candidate quality (anti fake-reconciliation) diagnostics ---
  aiAggregateRowsDetected: number;
  aiPlaceholderRowsDetected: number;
  aiCandidateQualityStatus: CandidateQualityStatus;
  aiCandidateQualityReasons: string[];
  aiCandidateRejectedForQuality: boolean;
  aiMissingDateRate: number | null;
  aiLowConfidenceRowRate: number | null;
  aiItemizedRowCount: number | null;
  aiLargestRowShareOfDebits: number | null;
  /** True when AI reduced the reconciliation difference but did NOT fully reconcile. */
  aiImprovedButStillUnreconciled: boolean;
  /** True when AI improved the difference but was NOT applied (still unreconciled, strict policy). */
  aiImprovedButNotAppliedStillUnreconciled: boolean;
  /** The AI candidate's residual difference when it did not fully reconcile (else null). */
  aiCandidateUnreconciledDifference: number | null;
  /** The parser candidate's reconciliation difference (for parser-vs-AI comparison). */
  parserCandidateDifference: number | null;
  /** The parser candidate's row count (for parser-vs-AI comparison). */
  parserCandidateRowCount: number | null;
  /** The (best) AI candidate's row count (for parser-vs-AI comparison). */
  aiCandidateRowCount: number | null;
  /** True when the parser result was kept because an AI candidate would have dropped rows. */
  parserRowsPreservedOverAiRows: boolean;
  // ----- Full-reconstruction strategy diagnostics (safe aggregates only) -----
  /** AI fallback mode actually used. */
  aiMode: "none" | "full-reconstruction";
  /** Rows in the (best) AI full reconstruction. */
  aiReconstructionRows: number | null;
  /** Parser candidate row count (alias surfaced alongside the reconstruction). */
  parserRows: number | null;
  /** Parser rows (by amount) the AI reconstruction dropped. */
  aiDroppedParserRowsCount: number | null;
  /** Rows (by amount) the AI reconstruction added vs the parser. */
  aiAddedRowsVsParserCount: number | null;
  /** Rows where the AI reconstruction flipped the debit/credit side vs the parser. */
  aiCorrectedRowsVsParserCount: number | null;
  /** The AI reconstruction's reconciliation difference. */
  aiReconstructionDifference: number | null;
  /** The parser candidate's reconciliation difference (alias). */
  parserDifference: number | null;
  /** True when the AI reconstruction fully reconciled. */
  aiReconciled: boolean;
  /** True when the AI reconstruction was adopted as the final result. */
  aiAdopted: boolean;
  /** Safe label for why the AI reconstruction was (not) adopted. */
  aiAdoptedReason: string | null;
  /** Evidence page indexes sent to the model (no pixels/text). */
  aiEvidencePages: number[];
  /** Number of evidence regions sent to the model. */
  aiEvidenceRegions: number | null;
  /** Number of input images sent to the model. */
  aiInputImageCount: number | null;
  /** What visual evidence the model actually received. */
  aiEvidenceMode: AiEvidenceMode;
  /** How complete the evidence coverage was. */
  aiEvidenceCoverageLevel: AiEvidenceCoverageLevel;
  /** 0..1 completeness of the selected page evidence. */
  aiEvidenceCompletenessScore: number | null;
  /** Pages selected for evidence (page numbers only). */
  selectedEvidencePages: number[];
  selectedEvidencePageCount: number | null;
  /** Selected pages / total pages. */
  pageCoverageRatio: number | null;
  /** True when ALL pages were sent (small-PDF / uncertain fallback). */
  allPagesFallbackUsed: boolean;
  transactionPagesSelected: number[];
  summaryAnchorPagesSelected: number[];
  pagesSkippedCount: number | null;
  pagesSkippedReasonCounts: Record<string, number>;
  /** True when ANY visual (image) evidence was sent — required for an independent visual rebuild. */
  aiIndependentEvidenceAvailable: boolean;
  /** True only when AI rebuilt from VISUAL evidence AND reconciled. */
  aiIndependentVisualReconstruction: boolean;
  /** Safe label when targeted crop regions could not be selected (fallback used). */
  regionSelectionFailedReason: string | null;
  /** True when full-page images were used (the default evidence mode). */
  fullPageFallbackUsed: boolean;
  /** Number of full-page images sent. */
  fallbackImageCount: number | null;
  /** Pages rendered as full-page images. */
  fallbackEvidencePages: number[];
  /** Best-guess safe label for why AI did not produce an adopted reconciliation. */
  aiFailureLikelyReason:
    | "insufficient-evidence"
    | "model-missed-rows"
    | "validation-mismatch"
    | "render-failure"
    | "quality-gate"
    | "none"
    | "unknown";
  /** Parser row counts by page (counts only; empty when page info unavailable). */
  parserRowsByPage: Record<number, number>;
  /** AI reconstruction row counts by page (counts only; empty when unavailable). */
  aiRowsByPage: Record<number, number>;
  /** Safe per-image vision evidence metadata, in send order (no pixels/text). */
  aiVisionEvidence: VisionImageMeta[];
  // ----- Section-coverage diagnostics (safe tokens/counts/numbers only) -----
  /** Transaction sections the AI reported reconstructing (fixed safe vocabulary). */
  aiDetectedTransactionSections: string[];
  /** Count of non-transaction sections the AI reported ignoring. */
  aiIgnoredNonTransactionSectionsCount: number | null;
  /** Model-reported cross-check of reconstructed section totals vs anchors. */
  aiSectionTotalsMatched: boolean | null;
  /** Safe token for a section the AI flagged as possibly missing (else null). */
  aiMissingSectionLikely: string | null;
  /** Safe amount the AI flagged as possibly missing (number only, else null). */
  aiPossibleMissingAmount: number | null;
  /** True when per-section summary anchors were supplied to the model. */
  aiSummaryAnchorsUsed: boolean;
  /** Whether the AI reported a fees / interest / payments / charges section. */
  aiFeesSectionDetected: boolean;
  aiInterestSectionDetected: boolean;
  aiPaymentsSectionDetected: boolean;
  aiChargesSectionDetected: boolean;
  /** Count of money-bearing NON-transaction sections the AI reported ignoring. */
  aiNonTransactionMoneySectionsDetected: number | null;
};

export type VisionSelectionDiag = {
  selectedPageIndexes: number[];
  selectedRegionKinds: string[];
  selectedRegionCount: number;
  transactionHeaderPagesDetected: number;
  summaryPagesDetected: number;
  excludedLegalPagesCount: number;
  excludedWarningRewardPagesCount: number;
};

export type AiAssistRun = {
  outcome: AiAssistOutcome;
  statement?: ParsedStatement;
  rows?: TransactionRow[];
};

export function aiAssistConfig(env: NodeJS.ProcessEnv = process.env): AiAssistConfig {
  const flag = env.ENABLE_AI_ASSIST;
  const key = env.OPENAI_API_KEY;
  const model = env.AI_ASSIST_MODEL;
  const missingConfig: string[] = [];
  if (!key) missingConfig.push("OPENAI_API_KEY");
  if (!model) missingConfig.push("AI_ASSIST_MODEL");
  const enabled = flag !== "false" && Boolean(key) && Boolean(model);
  const visionModel = env.AI_VISION_MODEL ?? model ?? null;
  return {
    enabled,
    model: model ?? null,
    hasKey: Boolean(key),
    missingConfig,
    visionEnabled: enabled && env.ENABLE_AI_VISION_FALLBACK !== "false" && Boolean(visionModel),
    visionModel,
    debugProviderMeta: env.AI_ASSIST_DEBUG_PROVIDER_META === "true",
  };
}

export type AiEligibility = {
  eligible: boolean;
  /** Safe labels for WHY AI may run (empty when verified). No statement content. */
  reasons: string[];
  /** Safe label for why AI was skipped (null when eligible). */
  skippedReason: string | null;
};

const hasAmt = (v: number | undefined) => typeof v === "number" && Math.abs(v) >= 0.005;

/**
 * Decide whether the AI fallback should run, with SAFE diagnostic labels. AI must
 * NOT run on an already-verified parser result (passed + high confidence + no
 * material row issues); it runs only when something material prevents verification.
 * Returns aggregate labels only — never statement content.
 */
export function evaluateAiEligibility(statement: ParsedStatement): AiEligibility {
  const v = statement.validation;
  const txns = statement.transactions;
  const reasons: string[] = [];

  // VERIFIED parser result: reconciled (passed), high confidence, known kind, with
  // rows. The parser already produced a strong itemized result, so AI is skipped —
  // even if a few rows have a missing date (a review nit handled by the UI, not a
  // reason to spend a vision call). This keeps AI strictly a fallback.
  const verified =
    v.status === "passed" &&
    v.confidence >= LOW_CONFIDENCE_THRESHOLD &&
    statement.statementKind !== "unknown" &&
    txns.length > 0 &&
    !txns.some((t) => !hasAmt(t.debit) && !hasAmt(t.credit));
  if (verified) {
    return { eligible: false, reasons: [], skippedReason: "parser-verified" };
  }

  if (v.status !== "passed") reasons.push("validation-not-passed");
  if (v.confidence < LOW_CONFIDENCE_THRESHOLD) reasons.push("low-confidence");
  if (statement.statementKind === "unknown") reasons.push("unknown-statement-kind");
  if (txns.length === 0) reasons.push("no-transactions");

  // A row with NO amount on either side is material (it cannot reconcile).
  if (txns.some((t) => !hasAmt(t.debit) && !hasAmt(t.credit))) {
    reasons.push("row-missing-amount");
  }
  // Missing date/description only matters when it affects a MATERIAL share of rows
  // (a single stray field on an otherwise-reconciling statement is not worth a call).
  if (txns.length > 0) {
    const missingMeta = txns.filter((t) => !t.transactionDate || !t.description.trim()).length;
    if (missingMeta / txns.length > 0.1) reasons.push("rows-missing-date-or-description");
  }

  const eligible = reasons.length > 0;
  return {
    eligible,
    reasons,
    // Skipped because the parser result is already verified / does not need help.
    skippedReason: eligible ? null : "parser-verified",
  };
}

/** AI assist is eligible ONLY when the parser result needs help. */
export function isAiAssistEligible(statement: ParsedStatement): boolean {
  return evaluateAiEligibility(statement).eligible;
}

// ----- Evidence (compact, no full raw doc) sent to the model -----

export type AiEvidence = {
  parserSummary: {
    statementKind: string;
    openingBalance: number | null;
    closingBalance: number | null;
    rowCount: number;
    totalDebits: number;
    totalCredits: number;
    validationStatus: string;
    difference: number | null;
    confidence: number;
  };
  validationIssues: string[];
  /** Opening/closing balance values DETECTED deterministically (the only ones AI may use). */
  detectedBalances: number[];
  detectedSummaryTotals: { credits: number | null; debits: number | null } | null;
  /**
   * Deterministic per-section anchor totals (credit-card), derived from already-
   * detected summary totals + current-period interest/fees. The model cross-checks
   * its reconstructed section totals against these (and must still itemize the rows;
   * an anchor is never a row). Null for non-credit-card statements. Numbers only.
   */
  expectedSectionTotals: {
    payments: number | null;
    charges: number | null;
    fees: number | null;
    interest: number | null;
  } | null;
  /** Account-section candidates (multi-account statements). */
  accountSections: { index: number; label: string; opening: number | null; closing: number | null; txCount: number }[];
  /** Per-candidate parser summaries (from scoring). */
  candidateSummaries: { name: string; rowCount: number; totalDebits: number; totalCredits: number; balanceStatus: string; difference: number | null }[];
  /** Compact transaction-region lines (NOT full document text). */
  regionLines: string[];
  /**
   * True when the parser captured ~no activity (near-zero totals or <=1 row) yet
   * the statement's own summary totals are meaningful — a strong signal the parser
   * MISSED the transaction table and the AI must rebuild rows from the images.
   */
  parserLikelyMissedTransactions: boolean;
  /**
   * Detected CURRENT-PERIOD credit-card interest/fee activity (part of Total
   * Debits). Lets the model include — and a deterministic step repair — the
   * interest/fee rows that a transaction-only pass tends to miss.
   */
  creditCardInterestFees: InterestFeeDetection | null;
  /**
   * "Blinders": a compact deterministic guide that focuses the model on the
   * itemized transaction table and supplies summary totals as TEXT anchors (so the
   * model validates against them instead of turning them into rows). No raw text.
   */
  blinders: BlindersPacket | null;
  transactions: {
    transactionDate: string | null;
    postingDate: string | null;
    description: string;
    debit: number | null;
    credit: number | null;
    amount: number;
    balance: number | null;
  }[];
};

export type InterestFeeDetection = {
  interestCharged: number | null;
  feesCharged: number | null;
  lineItems: { description: string; amount: number; date: string | null }[];
};

/**
 * Deterministic evidence packet that guides the vision call. Contains ONLY safe
 * anchors/targets/labels/region-ids — never raw statement text, rows, descriptions,
 * merchants, account numbers, names, prompts, AI responses, images, or base64.
 */
export type BlindersPacket = {
  /** AI fallback mode. "full-reconstruction" = rebuild the WHOLE itemized table. */
  mode: "full-reconstruction";
  statementKind: string;
  balanceMode: "bank-account" | "credit-card";
  openingAnchor: number | null;
  closingAnchor: number | null;
  totalCreditsTarget: number | null;
  totalDebitsTarget: number | null;
  period: { start: string | null; end: string | null } | null;
  parserFailureReasons: string[];
  transactionTablePages: number[];
  summaryPages: number[];
  tableHeaderPages: number[];
  allowedRegions: string[];
  excludedRegions: string[];
  /** Ordered list of the images the model is being sent (kind + page, no pixels). */
  visionEvidenceOrder: { id: string; kind: string; page: number }[];
  validationRequirements: string[];
  // ----- Loosened guidance: parser output is CONTEXT, not truth -----
  /** Parser context the AI may use to VALIDATE its own reconstruction (not copy). */
  parserContext: {
    rowCount: number;
    totalCredits: number | null;
    totalDebits: number | null;
    confidence: number | null;
    validationStatus: string | null;
  };
  /** Reconciliation residual (a validation clue, NOT the only thing to look for). */
  residual: number | null;
  /** Which side of activity the residual implies is missing/misread, if derivable. */
  likelyMissingDirection: "debit" | "credit" | "either" | null;
  /** Expected credit/debit totals derivable from the balance identity, if any. */
  expectedCredits: number | null;
  expectedDebits: number | null;
};

/** Build the Blinders packet from safe primitives (pure + testable). */
export function buildBlindersPacket(input: {
  statementKind: string;
  balanceMode: "bank-account" | "credit-card";
  openingAnchor: number | null;
  closingAnchor: number | null;
  totalCreditsTarget: number | null;
  totalDebitsTarget: number | null;
  period?: { start: string | null; end: string | null } | null;
  parserFailureReasons: string[];
  transactionTablePages: number[];
  summaryPages: number[];
  tableHeaderPages: number[];
  visionEvidenceOrder: { id: string; kind: string; page: number }[];
  parserContext?: {
    rowCount: number;
    totalCredits: number | null;
    totalDebits: number | null;
    confidence: number | null;
    validationStatus: string | null;
  };
  residual?: number | null;
  likelyMissingDirection?: "debit" | "credit" | "either" | null;
  expectedCredits?: number | null;
  expectedDebits?: number | null;
}): BlindersPacket {
  return {
    mode: "full-reconstruction",
    statementKind: input.statementKind,
    balanceMode: input.balanceMode,
    openingAnchor: input.openingAnchor,
    closingAnchor: input.closingAnchor,
    totalCreditsTarget: input.totalCreditsTarget,
    totalDebitsTarget: input.totalDebitsTarget,
    period: input.period ?? null,
    parserFailureReasons: input.parserFailureReasons,
    transactionTablePages: input.transactionTablePages,
    summaryPages: input.summaryPages,
    tableHeaderPages: input.tableHeaderPages,
    allowedRegions: ["transactions", "transactions-continued", "current-period-fees-interest"],
    excludedRegions: [
      "summary",
      "totals",
      "balance-summary",
      "payment-summary",
      "remittance",
      "rewards",
      "points",
      "year-to-date",
      "legal",
      "warning",
      "marketing",
    ],
    visionEvidenceOrder: input.visionEvidenceOrder,
    validationRequirements: [
      "PRIMARY OBJECTIVE: independently reconstruct the FULL itemized transaction table from the evidence — return EVERY visible itemized row, not just a residual patch.",
      "Parser context is CONTEXT, not truth: do not copy parser rows and do not over-trust them; re-extract from the images.",
      "Every row must be an itemized transaction visible in the transaction-table images, including page bottoms and continuation regions.",
      "Do not create summary, total, aggregate, balancing, placeholder, or 'miscellaneous' rows.",
      "Use the opening/closing anchors and credit/debit targets only to VALIDATE totals, never as transaction rows.",
      "The residual is a validation CLUE, not the only thing to search for: first reconstruct the full table, then check whether it explains the residual.",
      "Keep category/reference metadata OUT of the description when it is a structurally separate column.",
      "Use a missing date only when a row is clearly a continuation of a dated transaction block.",
      "If the rows are not legible enough to extract safely, return noSafeReconstruction with a reason instead of guessing.",
    ],
    parserContext: input.parserContext ?? {
      rowCount: 0,
      totalCredits: null,
      totalDebits: null,
      confidence: null,
      validationStatus: null,
    },
    residual: input.residual ?? null,
    likelyMissingDirection: input.likelyMissingDirection ?? null,
    expectedCredits: input.expectedCredits ?? null,
    expectedDebits: input.expectedDebits ?? null,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const sumDebits = (s: ParsedStatement) => s.transactions.reduce((a, t) => a + (t.debit ?? 0), 0);
const sumCredits = (s: ParsedStatement) => s.transactions.reduce((a, t) => a + (t.credit ?? 0), 0);

export function buildAiEvidence(
  statement: ParsedStatement,
  supplement: Partial<AiEvidence> = {},
): AiEvidence {
  const detected = new Set<number>();
  const add = (v: number | null | undefined) => {
    if (typeof v === "number" && Number.isFinite(v)) detected.add(round2(v));
  };
  add(statement.openingBalance);
  add(statement.closingBalance);
  for (const t of statement.transactions) add(t.balance);
  add(statement.summaryTotals?.totalCredits ?? null);
  add(statement.summaryTotals?.totalDebits ?? null);
  for (const v of supplement.detectedBalances ?? []) add(v);

  // Credit-card opening (Previous Balance) is frequently mislabeled by text
  // reconstruction when the summary is a horizontal totals row (the label sits in a
  // header row, so label-adjacency grabs the wrong column). It is, however, fully
  // implied by the AUTHORITATIVE detected values: previous = new - debits + credits.
  // Deriving it lets the AI legitimately use the real opening without inventing a
  // balance. Generic identity, not bank-specific.
  if (statement.statementKind === "credit-card") {
    const newBalance = statement.closingBalance;
    const cr = statement.summaryTotals?.totalCredits ?? supplement.detectedSummaryTotals?.credits ?? null;
    const db = statement.summaryTotals?.totalDebits ?? supplement.detectedSummaryTotals?.debits ?? null;
    if (typeof newBalance === "number" && typeof cr === "number" && typeof db === "number") {
      add(newBalance - db + cr);
    }
  }

  // Signal the "parser missed the table" shape so the model rebuilds rows from
  // the images instead of trusting the parser's near-empty result.
  const pCredits = sumCredits(statement);
  const pDebits = sumDebits(statement);
  const sumCr = statement.summaryTotals?.totalCredits ?? supplement.detectedSummaryTotals?.credits ?? null;
  const sumDb = statement.summaryTotals?.totalDebits ?? supplement.detectedSummaryTotals?.debits ?? null;
  const summaryMeaningful =
    (typeof sumCr === "number" && Math.abs(sumCr) >= 0.01) ||
    (typeof sumDb === "number" && Math.abs(sumDb) >= 0.01);
  const parserActivityNearZero = Math.abs(pCredits) < 0.01 && Math.abs(pDebits) < 0.01;
  const parserLikelyMissedTransactions =
    summaryMeaningful && (parserActivityNearZero || statement.transactions.length <= 1);

  // Per-section anchors (credit-card only): payments/charges from the summary totals,
  // fees/interest from detected current-period interest/fees. Derived from values
  // already detected deterministically — no new parsing, numbers only.
  const ccFees = supplement.creditCardInterestFees ?? null;
  const expectedSectionTotals =
    statement.statementKind === "credit-card"
      ? {
          payments: statement.summaryTotals?.totalCredits ?? supplement.detectedSummaryTotals?.credits ?? null,
          charges: statement.summaryTotals?.totalDebits ?? supplement.detectedSummaryTotals?.debits ?? null,
          fees: ccFees?.feesCharged ?? null,
          interest: ccFees?.interestCharged ?? null,
        }
      : null;

  return {
    parserLikelyMissedTransactions,
    creditCardInterestFees: supplement.creditCardInterestFees ?? null,
    expectedSectionTotals,
    blinders: supplement.blinders ?? null,
    parserSummary: {
      statementKind: statement.statementKind,
      openingBalance: statement.openingBalance ?? null,
      closingBalance: statement.closingBalance ?? null,
      rowCount: statement.transactions.length,
      totalDebits: round2(sumDebits(statement)),
      totalCredits: round2(sumCredits(statement)),
      validationStatus: statement.validation.status,
      difference: statement.validation.difference ?? null,
      confidence: statement.validation.confidence,
    },
    validationIssues: statement.validation.issues,
    detectedBalances: [...detected],
    detectedSummaryTotals: statement.summaryTotals
      ? {
          credits: statement.summaryTotals.totalCredits ?? null,
          debits: statement.summaryTotals.totalDebits ?? null,
        }
      : (supplement.detectedSummaryTotals ?? null),
    accountSections: supplement.accountSections ?? [],
    candidateSummaries: supplement.candidateSummaries ?? [],
    regionLines: (supplement.regionLines ?? []).slice(0, 400),
    // FULL-RECONSTRUCTION MODE: the parser's full row list (descriptions/amounts) is
    // intentionally NOT sent. Including it lets the model echo the parser instead of
    // independently reconstructing from the visual evidence. Parser context is
    // supplied as SAFE AGGREGATES only (parserSummary + blinders.parserContext);
    // row-level parser comparison is done deterministically AFTER the model returns.
    transactions: [],
  };
}

// ----- Strict response parsing & sanitization -----

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const finiteNum = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
const isObj = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);
const MAX_AI_ROWS = 2000;

function sanitizeTransactions(arr: unknown): Transaction[] | null {
  if (!Array.isArray(arr) || arr.length === 0 || arr.length > MAX_AI_ROWS) return null;
  const out: Transaction[] = [];
  for (const raw of arr) {
    if (!isObj(raw)) continue;
    const description = typeof raw.description === "string" ? raw.description.trim() : "";
    const debit = finiteNum(raw.debit);
    const credit = finiteNum(raw.credit);
    let amount = finiteNum(raw.amount);
    if (amount === undefined) {
      amount = debit !== undefined ? -Math.abs(debit) : credit !== undefined ? Math.abs(credit) : 0;
    }
    // A row with NO real amount on any side is not a transaction (e.g. a zero
    // "Interest Charge on Cash Advances $0.00" line or a section header the model
    // echoed). It contributes nothing to reconciliation, so drop it rather than
    // emit a "missing amount" warning row.
    const realAmount = (v: number | undefined) => v !== undefined && Math.abs(v) >= 0.005;
    if (!realAmount(debit) && !realAmount(credit) && !realAmount(amount)) continue;
    out.push({
      transactionDate: typeof raw.transactionDate === "string" ? raw.transactionDate : undefined,
      postingDate: typeof raw.postingDate === "string" ? raw.postingDate : undefined,
      description,
      debit: debit !== undefined ? Math.abs(debit) : undefined,
      credit: credit !== undefined ? Math.abs(credit) : undefined,
      amount,
      balance: finiteNum(raw.balance),
      confidence: typeof raw.confidence === "number" ? clamp01(raw.confidence) : 0.7,
      issues: Array.isArray(raw.issues) ? raw.issues.filter((x): x is string => typeof x === "string").slice(0, 10) : [],
    });
  }
  return out.length > 0 ? out : null;
}

/** Back-compat helper: parse a `{transactions:[...]}` body. */
export function parseAiTransactions(jsonText: string): Transaction[] | null {
  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!isObj(data)) return null;
  return sanitizeTransactions(data.transactions);
}

/**
 * Map a model-reported section label to a FIXED safe vocabulary token, or null
 * when it matches nothing known. This guarantees no arbitrary model free-text
 * (which could echo a merchant/section name) ever reaches diagnostics or logs.
 */
export function classifyTransactionSection(s: string): string | null {
  const l = s.toLowerCase();
  if (/payment/.test(l) && !/due|minimum|coupon|option|enclosed|slip/.test(l)) return "payments";
  if (/refund|reversal|return/.test(l)) return "refunds";
  if (/interest/.test(l)) return "interest";
  if (/\bfee|service charge/.test(l)) return "fees";
  if (/cash advance/.test(l)) return "cash-advances";
  if (/balance transfer/.test(l)) return "balance-transfers";
  if (/purchase|new charge|\bcharge/.test(l)) return "purchases";
  if (/credit/.test(l)) return "credits";
  return null;
}

export function classifyNonTransactionSection(s: string): string | null {
  const l = s.toLowerCase();
  if (/minimum payment/.test(l)) return "minimum-payment";
  if (/amount due|amount past due|new balance/.test(l)) return "amount-due";
  if (/payment due|due date/.test(l)) return "payment-due";
  if (/remittance|payment slip|tear[\s-]?off/.test(l)) return "remittance";
  if (/coupon/.test(l)) return "payment-coupon";
  if (/payment option/.test(l)) return "payment-options";
  if (/account summary|statement summary/.test(l)) return "account-summary";
  if (/reward|points/.test(l)) return "rewards";
  if (/spend report|spend categor/.test(l)) return "spend-report";
  if (/cash ?back|gift certificate|certificate/.test(l)) return "cashback";
  if (/legal|disclosure|terms/.test(l)) return "legal";
  if (/message|notice/.test(l)) return "message";
  if (/marketing|promo|offer/.test(l)) return "marketing";
  if (/summary|total/.test(l)) return "summary";
  return null;
}

const SAFE_SECTION_TOKENS = new Set([
  "payments", "credits", "refunds", "interest", "fees", "purchases",
  "charges", "cash-advances", "balance-transfers", "other",
]);
function safeSectionTokenList(v: unknown, classify: (s: string) => string | null): string[] {
  if (!Array.isArray(v)) return [];
  const out = new Set<string>();
  for (const item of v.slice(0, 30)) {
    if (typeof item !== "string") continue;
    const tok = classify(item);
    if (tok) out.add(tok);
  }
  return [...out];
}

/** Section-coverage metadata reported by the model (safe tokens/numbers only). */
export type AiSectionCoverage = {
  detectedTransactionSections: string[];
  ignoredNonTransactionSections: string[];
  sectionTotalsMatch: boolean | null;
  possibleMissingSection: string | null;
  possibleMissingAmount: number | null;
};

export type AiResponse = {
  candidate?: Record<string, unknown>;
  repairPlan?: Record<string, unknown>;
  /** Safe reason string when AI declares it cannot safely reconstruct the table. */
  noSafeReconstruction?: string;
  /** Safe, normalized section-coverage metadata (advisory diagnostics only). */
  sectionCoverage?: AiSectionCoverage;
};

/**
 * Parse the response. Full-reconstruction mode: the model returns an independent
 * candidate (as `candidate` OR a top-level `reconstructedTransactions` array), may
 * optionally include a secondary `repairPlan`, or may declare `noSafeReconstruction`.
 */
export function parseAiResponse(jsonText: string): AiResponse | null {
  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!isObj(data)) return null;
  let candidate = isObj(data.candidate) ? data.candidate : undefined;
  // Accept a top-level full-reconstruction array as an alias for candidate.transactions.
  if (!candidate && Array.isArray((data as Record<string, unknown>).reconstructedTransactions)) {
    candidate = {
      statementKind: data.statementKind,
      selectedSectionIndex: data.selectedSectionIndex,
      openingBalance: data.openingBalance,
      closingBalance: data.closingBalance,
      summaryTotals: data.summaryTotals,
      transactions: (data as Record<string, unknown>).reconstructedTransactions,
      confidence: data.confidence,
      issues: data.issues,
    };
  }
  const repairPlan = isObj(data.repairPlan) ? data.repairPlan : undefined;
  const d = data as Record<string, unknown>;
  const nsr = d.noSafeReconstruction;
  const nsrReason = d.noSafeReconstructionReason;
  const noSafeReconstruction =
    typeof nsr === "string"
      ? nsr
      : isObj(nsr) && typeof nsr.reason === "string"
        ? nsr.reason
        : typeof nsrReason === "string"
          ? nsrReason
          : undefined;
  if (!candidate && !repairPlan && !noSafeReconstruction) return null;

  // Section-coverage metadata: normalize to a FIXED safe vocabulary (no free text).
  const possibleMissingRaw =
    typeof d.possibleMissingSection === "string" ? d.possibleMissingSection : "";
  const sectionCoverage: AiSectionCoverage = {
    detectedTransactionSections: safeSectionTokenList(
      d.detectedTransactionSections,
      classifyTransactionSection,
    ),
    ignoredNonTransactionSections: safeSectionTokenList(
      d.ignoredNonTransactionSections,
      classifyNonTransactionSection,
    ),
    sectionTotalsMatch: typeof d.sectionTotalsMatch === "boolean" ? d.sectionTotalsMatch : null,
    possibleMissingSection: classifyTransactionSection(possibleMissingRaw),
    possibleMissingAmount: finiteNum(d.possibleMissingAmount) ?? null,
  };

  return { candidate, repairPlan, noSafeReconstruction, sectionCoverage };
}

const KINDS: StatementKind[] = ["bank-account", "credit-card", "unknown"];
function asKind(v: unknown, fallback: StatementKind): StatementKind {
  return typeof v === "string" && (KINDS as string[]).includes(v) ? (v as StatementKind) : fallback;
}
function supportedBalance(value: number, detected: number[], tol = 0.01): boolean {
  return detected.some((b) => Math.abs(b - value) <= tol);
}

export type CandidateBuild = {
  statement?: ParsedStatement;
  rejectedReason?: string;
  sectionIndex: number | null;
};

/**
 * Build an INDEPENDENT ParsedStatement candidate from AI output. Balances are
 * accepted only when they exist in detected evidence; an unsupported balance is
 * dropped back to the parser's detected balance (never invented) and noted.
 */
export function buildIndependentCandidate(
  parser: ParsedStatement,
  evidence: AiEvidence,
  raw: Record<string, unknown>,
  meta: BuildStatementMeta = {},
  allowedVisualRefs: Set<string> = new Set(),
): CandidateBuild {
  const sectionIndex = typeof raw.selectedSectionIndex === "number" ? raw.selectedSectionIndex : null;
  const txns = sanitizeTransactions(raw.transactions);
  if (!txns) {
    // AI returned no usable rows. If the parser already looks like it missed the
    // table, label it precisely so diagnostics show the table was never recovered.
    return {
      rejectedReason: evidence.parserLikelyMissedTransactions ? "no-transaction-table-candidate" : "no-usable-rows",
      sectionIndex,
    };
  }

  let rejectedReason: string | undefined;
  // A balance must be deterministically detected OR backed by a visual-evidence
  // reference to a provided image. Otherwise it is an invented balance → rejected.
  const visualRef = typeof raw.visualEvidenceReference === "string" ? raw.visualEvidenceReference : null;
  const visuallyBacked = visualRef !== null && allowedVisualRefs.has(visualRef);
  const pickBalance = (provided: unknown, parserValue: number | null): number | null => {
    const v = finiteNum(provided);
    if (v === undefined) return parserValue;
    if (supportedBalance(v, evidence.detectedBalances)) return v;
    if (visuallyBacked) return v; // present in a provided image
    rejectedReason = "unsupported-balance";
    return parserValue; // never use an invented balance
  };
  const opening = pickBalance(raw.openingBalance, parser.openingBalance ?? null);
  const closing = pickBalance(raw.closingBalance, parser.closingBalance ?? null);

  const st = isObj(raw.summaryTotals) ? (raw.summaryTotals as SummaryTotals) : undefined;
  const summary = {
    credits: finiteNum(st?.totalCredits) ?? evidence.detectedSummaryTotals?.credits ?? null,
    debits: finiteNum(st?.totalDebits) ?? evidence.detectedSummaryTotals?.debits ?? null,
  };

  const rows = txns.map(transactionToRow);
  const statement = buildStatementFromRows(
    rows,
    {
      statementKind: asKind(raw.statementKind, parser.statementKind),
      layoutFamily: parser.layoutFamily,
      openingBalance: opening,
      closingBalance: closing,
      summary,
    },
    meta,
  );

  // Diagnostic labels (safe, no private data): the candidate is still returned so
  // the comparator can reject it, but the label explains WHY it is unusable.
  if (!rejectedReason) {
    const candCr = rows.reduce((a, r) => a + (r.credit ?? 0), 0);
    const candDb = rows.reduce((a, r) => a + (r.debit ?? 0), 0);
    const sMeaningful =
      (typeof summary.credits === "number" && Math.abs(summary.credits) >= 0.01) ||
      (typeof summary.debits === "number" && Math.abs(summary.debits) >= 0.01);
    const candNearZero = Math.abs(candCr) < 0.01 && Math.abs(candDb) < 0.01;
    if (sMeaningful && (candNearZero || rows.length <= 1)) {
      // The AI returned a near-empty result while the summary shows real activity:
      // it ignored the transaction table (the exact false-pass shape).
      rejectedReason = "ai-returned-near-zero-rows";
    } else if (sMeaningful && opening !== null && closing !== null && opening === closing) {
      // Reused one balance as both opening and closing to fake a reconciliation.
      rejectedReason = "ai-ignored-summary-totals";
    }
  }
  return { statement, rejectedReason, sectionIndex };
}

/**
 * Apply a structured REPAIR PLAN to the parser result: add/delete/update rows and
 * re-select opening/closing from DETECTED balances only (e.g. choosing the real
 * account section's opening). The result is re-validated; unsupported balances are
 * rejected (kept at the parser's value) and noted.
 */
export function applyRepairPlan(
  parser: ParsedStatement,
  evidence: AiEvidence,
  plan: Record<string, unknown>,
  meta: BuildStatementMeta = {},
  allowedVisualRefs: Set<string> = new Set(),
): CandidateBuild {
  const sectionIndex = typeof plan.selectedSectionIndex === "number" ? plan.selectedSectionIndex : null;
  const base = parsedStatementToRows(parser);

  const deletes = new Set(
    Array.isArray(plan.rowsToDelete)
      ? plan.rowsToDelete.filter((i): i is number => typeof i === "number" && i >= 0 && i < base.length)
      : [],
  );
  const updates = new Map<number, Record<string, unknown>>();
  if (Array.isArray(plan.rowsToUpdate)) {
    for (const u of plan.rowsToUpdate) {
      if (isObj(u) && typeof u.index === "number" && u.index >= 0 && u.index < base.length) {
        updates.set(u.index, u);
      }
    }
  }

  let rows: TransactionRow[] = base
    .map((row, i) => {
      if (deletes.has(i)) return null;
      const u = updates.get(i);
      if (!u) return row;
      const debit = finiteNum(u.debit);
      const credit = finiteNum(u.credit);
      return {
        ...row,
        date: typeof u.transactionDate === "string" ? u.transactionDate : row.date,
        description: typeof u.description === "string" ? u.description : row.description,
        debit: debit !== undefined ? Math.abs(debit) : u.debit === null ? null : row.debit,
        credit: credit !== undefined ? Math.abs(credit) : u.credit === null ? null : row.credit,
        balance: finiteNum(u.balance) ?? row.balance,
      };
    })
    .filter((r): r is TransactionRow => r !== null);

  // Added rows must be sanitizable transaction rows (amount present); capped.
  if (Array.isArray(plan.rowsToAdd) && plan.rowsToAdd.length > 0) {
    const added = sanitizeTransactions(plan.rowsToAdd);
    if (added) rows = rows.concat(added.slice(0, base.length + 100).map(transactionToRow));
  }

  let rejectedReason: string | undefined;
  const visualRef = typeof plan.visualEvidenceReference === "string" ? plan.visualEvidenceReference : null;
  const visuallyBacked = visualRef !== null && allowedVisualRefs.has(visualRef);
  const pickBalance = (provided: unknown, parserValue: number | null): number | null => {
    const v = finiteNum(provided);
    if (v === undefined) return parserValue;
    if (supportedBalance(v, evidence.detectedBalances)) return v;
    if (visuallyBacked) return v;
    rejectedReason = "unsupported-balance";
    return parserValue;
  };
  const opening = pickBalance(plan.openingBalanceSourceCandidate, parser.openingBalance ?? null);
  const closing = pickBalance(plan.closingBalanceSourceCandidate, parser.closingBalance ?? null);

  if (rows.length === 0) return { rejectedReason: rejectedReason ?? "no-usable-rows", sectionIndex };

  const statement = buildStatementFromRows(
    rows,
    {
      statementKind: parser.statementKind,
      layoutFamily: parser.layoutFamily,
      openingBalance: opening,
      closingBalance: closing,
      summary: {
        credits: parser.summaryTotals?.totalCredits ?? null,
        debits: parser.summaryTotals?.totalDebits ?? null,
      },
    },
    meta,
  );
  return { statement, rejectedReason, sectionIndex };
}

// ----- Credit-card interest / fee repair -----

export type InterestFeeRepair = {
  statement: ParsedStatement;
  applied: boolean;
  rowsAdded: number;
  /** Set when a debit shortfall looks like missing interest/fees but can't be repaired. */
  issue: string | null;
};

let interestFeeRowSeq = 0;

/**
 * Close a credit-card debit shortfall caused by missing interest/fee rows. Total
 * Debits includes interest + fees, but those lines frequently sit in a separate
 * FEES / INTEREST section a transaction pass misses, leaving parsed debits short by
 * exactly the detected current-period interest/fees. This adds those rows from the
 * DETECTED evidence (never invented) ONLY when the credits already match and the
 * debit shortfall equals the detected amount, then revalidates. Idempotent: once
 * the rows are present the shortfall is ~0 and it no-ops, so it never duplicates.
 */
export function repairCreditCardInterestFees(
  statement: ParsedStatement,
  detected: InterestFeeDetection | null | undefined,
  meta: BuildStatementMeta = {},
): InterestFeeRepair {
  const noop: InterestFeeRepair = { statement, applied: false, rowsAdded: 0, issue: null };
  if (statement.statementKind !== "credit-card" || !detected) return noop;
  const meaningful = (v: number | null | undefined): v is number =>
    typeof v === "number" && Math.abs(v) >= 0.01;
  const summaryDb = statement.summaryTotals?.totalDebits ?? null;
  const summaryCr = statement.summaryTotals?.totalCredits ?? null;
  if (!meaningful(summaryDb)) return noop;

  const parsedDb = sumDebits(statement);
  const parsedCr = sumCredits(statement);
  // Only a DEBIT-side shortfall is an interest/fee gap; credits must already match.
  if (meaningful(summaryCr) && Math.abs(parsedCr - summaryCr) > 0.02) return noop;
  const short = round2(summaryDb - parsedDb);
  if (short <= 0.01) return noop; // debits already reconcile

  const TOL = 0.02;
  const items = detected.lineItems.filter((li) => Math.abs(li.amount) >= 0.01);
  const itemsTotal = round2(items.reduce((a, li) => a + Math.abs(li.amount), 0));
  const summaryIF = round2((detected.interestCharged ?? 0) + (detected.feesCharged ?? 0));

  let toAdd: { description: string; amount: number; date: string | null }[] = [];
  if (items.length > 0 && Math.abs(itemsTotal - short) <= TOL) {
    // Preferred: add the real, individually-detected interest/fee line items.
    toAdd = items.map((li) => ({ ...li }));
  } else if (summaryIF >= 0.01 && Math.abs(summaryIF - short) <= TOL) {
    // Fallback: synthesize from the detected current-period totals.
    if (meaningful(detected.interestCharged)) {
      toAdd.push({ description: "Interest Charged", amount: detected.interestCharged, date: null });
    }
    if (meaningful(detected.feesCharged)) {
      toAdd.push({ description: "Fees Charged", amount: detected.feesCharged, date: null });
    }
  } else {
    // A shortfall exists and interest/fees were detected, but they don't explain it
    // (or none were detected): flag rather than invent a row.
    const detectedAny = items.length > 0 || summaryIF >= 0.01;
    return { statement, applied: false, rowsAdded: 0, issue: detectedAny ? "missing-interest-or-fee-row" : null };
  }
  if (toAdd.length === 0) return noop;

  const closingDate = meta.periodEnd ?? statement.periodEnd ?? "";
  const rows = parsedStatementToRows(statement);
  for (const li of toAdd) {
    interestFeeRowSeq += 1;
    rows.push({
      id: `interest-fee-${interestFeeRowSeq}`,
      date: li.date ?? closingDate ?? "",
      description: li.description,
      debit: round2(Math.abs(li.amount)),
      credit: null,
      balance: null,
      category: "",
      confidence: 0.85,
    });
  }
  const repaired = buildStatementFromRows(
    rows,
    {
      statementKind: statement.statementKind,
      layoutFamily: statement.layoutFamily,
      openingBalance: statement.openingBalance ?? null,
      closingBalance: statement.closingBalance ?? null,
      summary: { credits: summaryCr, debits: summaryDb },
    },
    meta,
  );
  return { statement: repaired, applied: true, rowsAdded: toAdd.length, issue: null };
}

// ----- Candidate quality (anti "fake reconciliation") -----
// AGGREGATE_DESC_RE / PLACEHOLDER_DESC_RE are shared with final validation (see
// upload.ts) so the AI candidate-quality gate and the parser's own validation
// agree on what counts as a real itemized row.

export type CandidateQualityStatus = "ok" | "rejected" | "not-evaluated";

export type CandidateQuality = {
  status: CandidateQualityStatus;
  /** Safe labels describing any quality problems. No statement content. */
  reasons: string[];
  aggregateRows: number;
  placeholderRows: number;
  itemizedRows: number;
  missingDateRate: number;
  lowConfidenceRowRate: number;
  largestRowShareOfDebits: number;
};

const rate2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Detect "fake reconciliation": an AI candidate that balances arithmetically but
 * is built from aggregate/summary/placeholder rows instead of actual itemized
 * transactions. Arithmetic reconciliation is necessary but NOT sufficient — a
 * candidate must be made of real itemized rows. Returns safe aggregate signals
 * and a status of "rejected" when a hard problem is found. No statement content.
 */
export function evaluateCandidateQuality(
  s: ParsedStatement,
  opts: { hasVisionEvidence?: boolean } = {},
): CandidateQuality {
  const txns = s.transactions;
  const n = txns.length;
  const reasons: string[] = [];

  const aggregateRows = txns.filter((t) => AGGREGATE_DESC_RE.test(t.description ?? "")).length;
  const placeholderRows = txns.filter((t) => PLACEHOLDER_DESC_RE.test(t.description ?? "")).length;
  const nonItemized = txns.filter(
    (t) => AGGREGATE_DESC_RE.test(t.description ?? "") || PLACEHOLDER_DESC_RE.test(t.description ?? ""),
  ).length;
  const itemizedRows = n - nonItemized;

  const missingDate = txns.filter((t) => !t.transactionDate || !String(t.transactionDate).trim()).length;
  const lowConf = txns.filter((t) => t.confidence < LOW_CONFIDENCE_THRESHOLD).length;
  const missingDateRate = n > 0 ? missingDate / n : 0;
  const lowConfidenceRowRate = n > 0 ? lowConf / n : 0;

  const debitOf = (t: Transaction) => Math.abs(t.debit ?? 0);
  const totalDebits = txns.reduce((a, t) => a + debitOf(t), 0);
  const largestDebit = txns.reduce((m, t) => Math.max(m, debitOf(t)), 0);
  const largestRowShareOfDebits = totalDebits > 0.005 ? largestDebit / totalDebits : 0;

  const meaningful = (v: number | null | undefined): v is number =>
    typeof v === "number" && Math.abs(v) >= 0.01;
  const meaningfulSummaryDebits = meaningful(s.summaryTotals?.totalDebits ?? null);

  // HARD signals: the candidate is not a real itemized extraction.
  if (aggregateRows + placeholderRows > 0) reasons.push("ai-aggregate-placeholder-row");

  // A SOLE debit row whose amount equals the total debits/purchases is a "plug"
  // standing in for the whole table, not a transaction. (Note: a single legitimate
  // payment can equal total payments, so credit-side matches are NOT flagged, and
  // we require the debit row to account for ALL debits, not just be the largest.)
  const debitSummaryValues = [s.summaryTotals?.totalDebits, s.summaryTotals?.totalPurchases].filter(
    (v): v is number => meaningful(v),
  );
  const soleDebitEqualsTotal =
    n >= 2 &&
    meaningfulSummaryDebits &&
    txns.some((t) => {
      const d = debitOf(t);
      if (d < 0.01) return false;
      const otherDebits = totalDebits - d;
      return otherDebits < 0.01 && debitSummaryValues.some((v) => Math.abs(d - v) <= 0.01);
    });
  if (soleDebitEqualsTotal) reasons.push("ai-summary-row-as-transaction");

  // Too few itemized rows when the (vision) evidence implies a real multi-row table
  // exists but almost all the debit value sits in one or two rows.
  if (opts.hasVisionEvidence && meaningfulSummaryDebits && itemizedRows < 3 && largestRowShareOfDebits >= 0.85) {
    reasons.push("ai-too-few-itemized-rows");
  }

  // SOFT signals (recorded; do not by themselves reject a fully itemized set).
  if (n > 0 && missingDateRate > 0.5) reasons.push("ai-high-missing-date-rate");
  if (n > 0 && lowConfidenceRowRate > 0.5) reasons.push("ai-too-many-low-confidence-rows");

  const HARD = new Set([
    "ai-aggregate-placeholder-row",
    "ai-summary-row-as-transaction",
    "ai-fake-reconciliation-risk",
    "ai-too-few-itemized-rows",
  ]);
  const status: CandidateQualityStatus = reasons.some((r) => HARD.has(r)) ? "rejected" : "ok";

  return {
    status,
    reasons,
    aggregateRows,
    placeholderRows,
    itemizedRows,
    missingDateRate: rate2(missingDateRate),
    lowConfidenceRowRate: rate2(lowConfidenceRowRate),
    largestRowShareOfDebits: rate2(largestRowShareOfDebits),
  };
}

// ----- Candidate comparison & adoption -----

export type CandidateMetrics = {
  status: ParsedStatement["validation"]["status"];
  difference: number | null;
  rowCount: number;
  confidence: number;
  issueCount: number;
};

/**
 * Safe, count-only structural comparison of an AI candidate's rows against the
 * parser's rows (by signed/absolute amount multisets — never row text). Powers the
 * "did AI drop/add/correct rows" diagnostics and adoption safety.
 */
export function compareRowsToParser(
  parser: ParsedStatement,
  cand: ParsedStatement,
): { dropped: number; added: number; corrected: number } {
  const signedCents = (t: Transaction) => Math.round((t.amount ?? 0) * 100);
  const absCents = (t: Transaction) => Math.abs(Math.round((t.amount ?? 0) * 100));
  const multiset = (xs: number[]) => {
    const m = new Map<number, number>();
    for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
    return m;
  };
  const pSigned = multiset(parser.transactions.map(signedCents));
  const aSigned = multiset(cand.transactions.map(signedCents));
  const aAbs = multiset(cand.transactions.map(absCents));
  let dropped = 0;
  for (const [k, c] of pSigned) dropped += Math.max(0, c - (aSigned.get(k) ?? 0));
  let added = 0;
  for (const [k, c] of aSigned) added += Math.max(0, c - (pSigned.get(k) ?? 0));
  // Side/amount correction: a parser row whose ABS amount appears in the AI rows but
  // whose SIGNED amount does not (the side was flipped or the amount adjusted).
  let corrected = 0;
  for (const t of parser.transactions) {
    if ((aSigned.get(signedCents(t)) ?? 0) === 0 && (aAbs.get(absCents(t)) ?? 0) > 0) corrected += 1;
  }
  return { dropped, added, corrected };
}

export function candidateMetrics(s: ParsedStatement): CandidateMetrics {
  const d = s.validation.difference;
  return {
    status: s.validation.status,
    difference: typeof d === "number" ? Math.abs(d) : null,
    rowCount: s.transactions.length,
    confidence: s.validation.confidence,
    issueCount: s.validation.issues.length,
  };
}

/**
 * How far a statement's parsed credit/debit totals are from its OWN printed summary
 * totals (sum of |credit gap| + |debit gap|). This is the key signal for the
 * "parser missed the table" case: a near-empty parser can reconcile its balances
 * coincidentally (difference ~0) yet be wildly off the statement's own totals, while
 * a candidate that rebuilt the table matches those totals closely. Null when the
 * statement has no meaningful summary totals to compare against.
 */
function summaryTotalsMismatch(s: ParsedStatement): number | null {
  const st = s.summaryTotals;
  const cr = st?.totalCredits ?? null;
  const db = st?.totalDebits ?? null;
  const meaningful = (v: number | null): v is number => typeof v === "number" && Math.abs(v) >= 0.01;
  if (!meaningful(cr) && !meaningful(db)) return null;
  let mismatch = 0;
  if (meaningful(cr)) mismatch += Math.abs(sumCredits(s) - cr);
  if (meaningful(db)) mismatch += Math.abs(sumDebits(s) - db);
  return mismatch;
}

/** Does `cand` reconcile, or materially improve over `parser` without new issues? */
export function candidateBeatsParser(parser: ParsedStatement, cand: ParsedStatement): boolean {
  const p = candidateMetrics(parser);
  const c = candidateMetrics(cand);
  if (c.status === "passed" && p.status !== "passed") return true;
  if (c.status === "passed" && p.status === "passed") return c.confidence > p.confidence + 1e-9;

  // The parser missed the transaction table when its parsed totals are wildly off the
  // statement's own summary totals. In that case its near-zero balance "difference"
  // is meaningless. A candidate that rebuilt the table and matches those summary
  // totals far better (and has materially more rows) is strictly better — adopt it
  // so the real transactions surface (still validated → needs-review if not exact).
  const pMis = summaryTotalsMismatch(parser);
  const cMis = summaryTotalsMismatch(cand);
  if (pMis !== null && cMis !== null && c.rowCount > p.rowCount && cMis < pMis - 0.5 && cMis < pMis * 0.5) {
    return true;
  }

  if (p.difference !== null && c.difference !== null) {
    // A still-UNRECONCILED AI candidate may only win on a smaller difference when it
    // does not DROP valid parser rows. Otherwise a candidate can "improve" the
    // arithmetic gap merely by deleting real transactions — never adopt that. When
    // both are incomplete, prefer the one with the most real itemized rows.
    if (
      c.difference < p.difference - 0.005 &&
      c.issueCount <= p.issueCount &&
      c.rowCount >= p.rowCount
    ) {
      return true;
    }
  }
  if (c.confidence > p.confidence + 1e-9 && (c.difference ?? Infinity) <= (p.difference ?? Infinity)) return true;
  return false;
}

type Labeled = { source: AdoptedCandidateSource; statement: ParsedStatement; interestFeeRowsAdded?: number };
/** Rank AI candidates: reconciled first, then smallest difference, then confidence. */
function rankAi(list: Labeled[]): Labeled | undefined {
  return [...list].sort((a, b) => {
    const ma = candidateMetrics(a.statement);
    const mb = candidateMetrics(b.statement);
    const pa = ma.status === "passed" ? 0 : 1;
    const pb = mb.status === "passed" ? 0 : 1;
    if (pa !== pb) return pa - pb;
    const da = ma.difference ?? Infinity;
    const db = mb.difference ?? Infinity;
    if (da !== db) return da - db;
    return mb.confidence - ma.confidence;
  })[0];
}

// ----- OpenAI call -----

export type ChatProviderMeta = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  responseId: string | null;
};
export type ChatResult = {
  ok: boolean;
  content: string | null;
  errorLabel: string | null;
  meta?: ChatProviderMeta;
};

/** A multimodal user-message content part (text or an image data URL). */
export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };
export type ChatMessage = { role: "system" | "user"; content: string | ChatContentPart[] };

export const SYSTEM_PROMPT =
  "You correct bank/credit-card statement extraction. You are given the parser's " +
  "current rows, its opening/closing/summary, the validation difference, the list " +
  "of opening/closing balance values DETECTED in the statement, any account-section " +
  "candidates, and compact transaction-region lines. Return STRICT JSON ONLY, no " +
  'prose, of the form {"candidate": <object|null>, "repairPlan": <object|null>}. ' +
  '"candidate" is an independent statement: {statementKind, selectedSectionIndex, ' +
  "openingBalance, closingBalance, summaryTotals, transactions:[{transactionDate," +
  "postingDate,description,debit,credit,amount,balance,confidence,issues}], " +
  'confidence, issues}. "repairPlan" is: {selectedCandidateId, selectedSectionIndex, ' +
  "rowsToAdd:[...transactions], rowsToDelete:[rowIndex], rowsToUpdate:[{index,...}], " +
  "openingBalanceSourceCandidate, closingBalanceSourceCandidate, confidence, issues}. " +
  "Prefer opening/closing balances that appear in the provided detected balances. " +
  "If you use a balance that is NOT in the detected balances, it must be clearly " +
  'visible in a provided image and you MUST set "visualEvidenceReference" to that ' +
  "image's id; otherwise do not use it. Do NOT invent balances. Add rows ONLY if " +
  "supported by the provided region lines or images. Goal: bank opening + credits " +
  "- debits = closing; credit card previous + debits - credits = closing. Use null " +
  "for unknown fields. " +
  "IMPORTANT — missing transactions: if evidence.parserLikelyMissedTransactions is " +
  "true (or the parser's totalDebits/totalCredits are near zero, or rowCount is 0 or " +
  "1, while the detected summary totals are clearly non-zero), the parser almost " +
  "certainly MISSED the real transaction table. In that case treat the parser result " +
  "as INVALID: do NOT accept the parser's rows, do NOT return a one-row candidate, and " +
  "do NOT report a balance check as passing. In this case you MUST return an independent " +
  '"candidate" containing the COMPLETE transactions array rebuilt from the TRANSACTIONS ' +
  "image crops — do NOT return only a repairPlan (a repair plan cannot recover a table " +
  "the parser never saw). Map Previous Balance to openingBalance and New Balance to " +
  "closingBalance (never the same value for both). Aim for the parsed credits/debits to " +
  "match the detected summary totals. " +
  "Extract the real transactions from the TRANSACTIONS pages/images (including any " +
  "'TRANSACTIONS Continued' sections that follow summary or legal pages). " +
  "Credit-card Total Debits also INCLUDES current-period Fees and Interest, so also " +
  "extract NONZERO current-period fee/interest line items (e.g. 'FEES', 'INTEREST', " +
  "'Interest Charge on Purchases', 'Interest Charge on Cash Advances', 'TOTAL FEES/" +
  "INTEREST FOR THIS PERIOD') as debit rows — do NOT drop them, or Total Debits will " +
  "be short by that amount. Ignore ZERO fee/interest lines and YEAR-TO-DATE / prior-" +
  "year totals (e.g. 'Total Interest Charged in 2025', 'year-to-date'). IGNORE " +
  "legal/disclosure text, payment/remittance slips, rewards/points pages, and " +
  "warning/notice lines such as balance-protection or 'on your last statement' " +
  "notices — these are NEVER transactions. NEVER use the new/closing balance as both " +
  "the opening and closing balance to fabricate a passing reconciliation. If you " +
  "cannot recover the real transactions from the provided evidence, return a candidate " +
  "with issues describing what is missing (no fake balance) rather than a false pass. " +
  "CRITICAL — itemized rows only, no fake reconciliation: every transaction row MUST be " +
  "an actual itemized line you can see in the transaction table (or a clearly itemized " +
  "fee/interest line in an allowed region). Do NOT create aggregate, summary, or " +
  "placeholder rows to force the totals to balance. Specifically, NEVER output rows " +
  "like 'Unspecified purchases/charges', 'Other charges', 'Purchases and charges', " +
  "'Summary', 'Total purchases', 'Total debits', 'Total credits', 'Missing " +
  "transactions', 'Various', 'Miscellaneous', a remaining/plug amount, or a single row " +
  "whose amount equals a printed summary total. Do NOT use payment-summary, remittance, " +
  "rewards, warning, legal, year-to-date, totals, or balance-summary sections as " +
  "transaction rows. Do NOT invent dates, descriptions, or amounts; a missing date is " +
  "only acceptable when the row is clearly a continuation of a visible dated row, and " +
  "should be rare. It is BETTER to return a candidate with issues (needs review) than a " +
  "reconciled candidate built from aggregate or placeholder rows: if the visual " +
  "evidence is insufficient to extract the itemized rows, return needs-review issues " +
  "instead of a balanced-but-fake candidate. " +
  "COMPLETENESS — extract EVERY visible itemized row: the image evidence is ordered " +
  "transaction-table-first (see evidence.blinders.visionEvidenceOrder); each image is " +
  "a chunk of the transaction table (overlapping halves, so the same row may appear in " +
  "two chunks — output it once). Read ALL of them and return EVERY itemized transaction " +
  "you can see. Do NOT stop after one or two rows. If dozens of rows are visible, return " +
  "dozens of rows (40, 60, 80+ is normal and expected for a full statement). A long, " +
  "fully itemized candidate is ALWAYS preferred over a short candidate that only explains " +
  "the totals. Use evidence.blinders openingAnchor/closingAnchor and the credit/debit " +
  "targets ONLY to check your extraction adds up — never turn an anchor or target into a " +
  "row. Return strict JSON only. The only acceptable reason to return few rows is that " +
  "the table rows are genuinely not legible in the images; in that case return " +
  "needs-review issues, not a short reconciled summary. " +
  "FULL-RECONSTRUCTION MODE (the only mode): your PRIMARY objective is to rebuild the " +
  "WHOLE itemized transaction table independently from the evidence — NOT to patch a " +
  "single residual. evidence.blinders.parserContext (row count, totals, confidence, " +
  "validation status) is CONTEXT, not truth: do not copy the parser's rows and do not " +
  "over-trust them; re-extract from the images. evidence.blinders.residual (with " +
  "likelyMissingDirection / expectedCredits / expectedDebits) is a VALIDATION CLUE " +
  "only: first reconstruct the full table, THEN check whether your reconstruction " +
  "explains the residual; never tunnel-vision on one missing amount. You may return " +
  'the array as "candidate.transactions" or equivalently "reconstructedTransactions"; ' +
  'if you genuinely cannot safely reconstruct the table, return "noSafeReconstruction" ' +
  "with a short reason instead of a partial or fabricated candidate. " +
  "SECTION-AWARE RECONSTRUCTION (general, any issuer — never bank-specific): a " +
  "credit-card statement groups money into several sections. FIRST identify the posted " +
  "itemized TRANSACTION sections — payments, credits/refunds, interest, fees, purchases/" +
  "new charges, cash advances, balance transfers, and any other posted itemized activity " +
  "— and reconstruct rows ONLY from them. EXPLICITLY IGNORE non-transaction sections and " +
  "never output them as rows: minimum payment due, amount due, payment due date, " +
  "remittance/payment slip, payment coupon, total payment enclosed, payment options, " +
  "account summary, rewards summary, spend report, cashback/gift certificate, and legal/" +
  "message/marketing pages. " +
  "SECTION-TOTAL CROSS-CHECK: when summary anchors are provided (evidence." +
  "expectedSectionTotals, evidence.detectedSummaryTotals, evidence.creditCardInterestFees, " +
  "and the blinders credit/debit targets), cross-check your reconstructed section totals " +
  "against them — posted payment/credit rows should total the summary payments/credits, and " +
  "itemized purchases + fees + interest should total the summary total charges/debits. " +
  "Include an itemized FEE row even when a fees total also appears in the summary; include " +
  "itemized INTEREST rows even when an interest total also appears in the summary — a summary " +
  "total is NOT a substitute for the itemized line, and dropping it leaves Total Debits short. " +
  "Do NOT include the minimum payment due as a payment/credit; do NOT include amount due or " +
  "new balance as a transaction; do NOT include rewards, spend reports, cashback/gift " +
  "certificates, or payment coupons as transactions. If the residual equals a known itemized " +
  "section amount (a fee, an interest charge, or a payment), RE-CHECK that section in the " +
  "images before returning. A PARTIAL improvement is a FAILURE unless the reconstructed " +
  "statement fully reconciles. " +
  "Optionally include these SAFE structural fields (category labels and numbers only — never " +
  "row text, merchants, or account data) so coverage can be checked: " +
  '"detectedTransactionSections" (e.g. ["payments","interest","fees","purchases"]), ' +
  '"ignoredNonTransactionSections", "reconstructedSectionTotals", "expectedSectionTotals", ' +
  '"sectionTotalsMatch" (boolean), "possibleMissingSection", "possibleMissingAmount", and ' +
  '"noSafeReconstructionReason".';

export async function callOpenAiChat(
  messages: ChatMessage[],
  config: AiAssistConfig,
  opts: { jsonMode?: boolean; maxTokens?: number; model?: string } = {},
): Promise<ChatResult> {
  const key = process.env.OPENAI_API_KEY;
  const model = opts.model ?? config.model;
  if (!key) return { ok: false, content: null, errorLabel: "no-key" };
  if (!model) return { ok: false, content: null, errorLabel: "no-model" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const body: Record<string, unknown> = { model, messages };
    if (opts.jsonMode) body.response_format = { type: "json_object" };
    if (opts.maxTokens) body.max_completion_tokens = opts.maxTokens;
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, content: null, errorLabel: `http-${res.status}` };
    const data = (await res.json()) as {
      id?: string;
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const content = data.choices?.[0]?.message?.content;
    const meta: ChatProviderMeta = {
      inputTokens: data.usage?.prompt_tokens ?? null,
      outputTokens: data.usage?.completion_tokens ?? null,
      totalTokens: data.usage?.total_tokens ?? null,
      responseId: typeof data.id === "string" ? data.id : null,
    };
    if (typeof content !== "string" || !content.trim()) {
      return { ok: false, content: null, errorLabel: "empty-response", meta };
    }
    return { ok: true, content, errorLabel: null, meta };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return { ok: false, content: null, errorLabel: aborted ? "timeout" : "network-error" };
  } finally {
    clearTimeout(timer);
  }
}

/** One multimodal fallback request: compact evidence + optional rendered images. */
export type AiRequest = { evidence: AiEvidence; images: VisionImage[] };

/** Caller seam so tests exercise every path without a network call. */
export type ChatCaller = (request: AiRequest, config: AiAssistConfig) => Promise<ChatResult>;

/**
 * Default caller: builds ONE multimodal message (text evidence + image parts) and
 * uses the vision model when images are present, otherwise the text model. There
 * is never a separate text call followed by a vision call.
 */
const defaultCaller: ChatCaller = ({ evidence, images }, config) => {
  const userContent: ChatContentPart[] = [{ type: "text", text: JSON.stringify(evidence) }];
  if (images.length > 0) {
    // Tell the model what the images are and in what order (transaction-table chunks
    // first), so it reads them as table rows and extracts the full itemized list.
    userContent.push({
      type: "text",
      text:
        `The ${images.length} images below are RENDERED STATEMENT PAGE IMAGES (full pages and/or table ` +
        "chunks), in page order. Reconstruct the COMPLETE itemized transaction table from this visual " +
        "evidence. Return EVERY visible itemized transaction row across ALL images — do not summarize and " +
        "do not stop early (dozens of rows are normal). Include rows without a running balance, page-bottom " +
        "rows, and continuation rows; carry a date forward only when the table structure visually justifies " +
        "it. Include fees, cheques, debit/card purchases, credits, deposits, e-Transfers, transfers, bill " +
        "payments, loan payments, taxes, payroll, interest, refunds, and payments when shown as itemized " +
        "rows. A row may appear in two overlapping chunks — output it once. Do NOT create balancing/summary " +
        "rows and do NOT turn opening/closing balances or totals into rows (they are validation anchors in " +
        "evidence.blinders). If the table cannot be read completely from the images, return " +
        "noSafeReconstruction with a reason instead of inventing rows.",
    });
  }
  for (const img of images) userContent.push({ type: "image_url", image_url: { url: img.dataUrl } });
  const model = images.length > 0 ? (config.visionModel ?? config.model) : config.model;
  return callOpenAiChat(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: images.length > 0 ? userContent : JSON.stringify(evidence) },
    ],
    config,
    // Generous output cap so a long (80+ row) itemized JSON answer is never truncated.
    { jsonMode: true, model: model ?? undefined, maxTokens: 8000 },
  );
};

export type AiAssistOptions = {
  evidence?: Partial<AiEvidence>;
  /** Rendered vision images (crops/pages). When present the call is multimodal. */
  images?: VisionImage[];
  /** Why vision rendering produced no images (surfaced in diagnostics). */
  renderFailedReason?: string | null;
  /** Safe aggregate vision page/region selection diagnostics. */
  visionSelection?: VisionSelectionDiag | null;
  /** Safe page-evidence plan diagnostics (rendered-page selection + completeness). */
  evidencePlan?: EvidencePlanDiag | null;
  call?: ChatCaller;
  env?: NodeJS.ProcessEnv;
  /**
   * DEV-ONLY: force the AI fallback to run even when the parser result is verified
   * (i.e. would normally skip AI). Used solely by the local forced-reconstruction
   * test harness. The production route NEVER sets this, so normal "parser-verified
   * skips AI" behavior is unchanged. Adoption rules are NOT bypassed — only the
   * eligibility short-circuit is.
   */
  force?: boolean;
};

function baseOutcome(statement: ParsedStatement, config: AiAssistConfig): AiAssistOutcome {
  const d = statement.validation.difference;
  const elig = evaluateAiEligibility(statement);
  return {
    eligible: elig.eligible,
    configured: config.hasKey && Boolean(config.model),
    enabled: config.enabled,
    attempted: false,
    called: false,
    responseReceived: false,
    applied: false,
    improved: false,
    status: "not-eligible",
    model: config.model,
    missingConfig: config.missingConfig,
    preDifference: typeof d === "number" ? Math.abs(d) : null,
    postDifference: null,
    improvement: null,
    errorLabel: null,
    aiIndependentCandidateBuilt: false,
    aiRepairPlanBuilt: false,
    aiCandidateDifference: null,
    aiRepairPlanDifference: null,
    adoptedCandidateSource: "parser",
    aiSelectedSectionIndex: null,
    aiRejectedReason: null,
    candidateComparisonCount: 1,
    aiFallbackType: "none",
    aiCallCount: 0,
    aiVisionUsed: false,
    aiRenderedPagesCount: 0,
    aiImageCropsCount: 0,
    aiFullPageImagesCount: 0,
    aiInputTokenCount: null,
    aiOutputTokenCount: null,
    aiTotalTokenCount: null,
    aiProviderResponseId: null,
    aiRenderFailedReason: null,
    visionSelection: null,
    aiCallDurationMs: null,
    renderDurationMs: null,
    routeDurationMs: null,
    interestFeeRepairApplied: false,
    interestFeeRowsAdded: 0,
    aiEligibilityReasons: elig.reasons,
    aiSkippedReason: elig.skippedReason,
    rendererBackendAvailable: null,
    rendererBackendName: null,
    rendererProbeReason: null,
    aiAggregateRowsDetected: 0,
    aiPlaceholderRowsDetected: 0,
    aiCandidateQualityStatus: "not-evaluated",
    aiCandidateQualityReasons: [],
    aiCandidateRejectedForQuality: false,
    aiMissingDateRate: null,
    aiLowConfidenceRowRate: null,
    aiItemizedRowCount: null,
    aiLargestRowShareOfDebits: null,
    aiImprovedButStillUnreconciled: false,
    aiImprovedButNotAppliedStillUnreconciled: false,
    aiCandidateUnreconciledDifference: null,
    parserCandidateDifference: null,
    parserCandidateRowCount: null,
    aiCandidateRowCount: null,
    parserRowsPreservedOverAiRows: false,
    aiMode: "none",
    aiReconstructionRows: null,
    parserRows: null,
    aiDroppedParserRowsCount: null,
    aiAddedRowsVsParserCount: null,
    aiCorrectedRowsVsParserCount: null,
    aiReconstructionDifference: null,
    parserDifference: null,
    aiReconciled: false,
    aiAdopted: false,
    aiAdoptedReason: null,
    aiEvidencePages: [],
    aiEvidenceRegions: null,
    aiInputImageCount: null,
    aiEvidenceMode: "none",
    aiEvidenceCoverageLevel: "none",
    aiEvidenceCompletenessScore: null,
    selectedEvidencePages: [],
    selectedEvidencePageCount: null,
    pageCoverageRatio: null,
    allPagesFallbackUsed: false,
    transactionPagesSelected: [],
    summaryAnchorPagesSelected: [],
    pagesSkippedCount: null,
    pagesSkippedReasonCounts: {},
    aiIndependentEvidenceAvailable: false,
    aiIndependentVisualReconstruction: false,
    regionSelectionFailedReason: null,
    fullPageFallbackUsed: false,
    fallbackImageCount: null,
    fallbackEvidencePages: [],
    aiFailureLikelyReason: "none",
    parserRowsByPage: {},
    aiRowsByPage: {},
    aiVisionEvidence: [],
    aiDetectedTransactionSections: [],
    aiIgnoredNonTransactionSectionsCount: null,
    aiSectionTotalsMatched: null,
    aiMissingSectionLikely: null,
    aiPossibleMissingAmount: null,
    aiSummaryAnchorsUsed: false,
    aiFeesSectionDetected: false,
    aiInterestSectionDetected: false,
    aiPaymentsSectionDetected: false,
    aiChargesSectionDetected: false,
    aiNonTransactionMoneySectionsDetected: null,
  };
}

/**
 * Orchestrate AI assist: build evidence → ask AI for an independent candidate
 * and/or a repair plan → build candidate ParsedStatements → compare with the
 * parser via the same validation engine → adopt only if it reconciles or
 * materially improves. Always returns an explicit, truthful outcome.
 */
export async function runAiAssist(
  statement: ParsedStatement,
  config: AiAssistConfig,
  meta: BuildStatementMeta = {},
  opts: AiAssistOptions = {},
): Promise<AiAssistRun> {
  const env = opts.env ?? process.env;
  const out = baseOutcome(statement, config);
  out.aiRenderFailedReason = opts.renderFailedReason ?? null;
  out.visionSelection = opts.visionSelection ?? null;

  // DEV-ONLY force: bypass the eligibility short-circuit so the forced-reconstruction
  // harness can exercise AI on a parser-verified statement. Adoption rules below are
  // unchanged. Production never sets opts.force.
  if (opts.force && !out.eligible) {
    out.eligible = true;
    out.aiEligibilityReasons = [...out.aiEligibilityReasons, "forced-dev-harness"];
  }
  if (!out.eligible) return { outcome: out };
  if (!config.enabled) {
    out.status = env.ENABLE_AI_ASSIST === "false" ? "disabled" : "not-configured";
    return { outcome: out };
  }

  const evidence = buildAiEvidence(statement, opts.evidence);
  const images = opts.images ?? [];
  const allowedVisualRefs = new Set(images.map((i) => i.id));

  // ONE multimodal fallback call (never text-then-vision). Record vision aggregates.
  out.aiVisionUsed = images.length > 0;
  out.aiFallbackType = images.length > 0 ? "vision" : "text-layout";
  out.aiImageCropsCount = images.filter((i) => i.crop).length;
  out.aiFullPageImagesCount = images.filter((i) => !i.crop).length;
  out.aiRenderedPagesCount = new Set(images.map((i) => i.page)).size;
  // Full-reconstruction strategy: the single fallback call rebuilds the whole table.
  out.aiMode = "full-reconstruction";
  out.aiInputImageCount = images.length;
  out.aiEvidencePages = opts.visionSelection?.selectedPageIndexes ?? [];
  out.aiEvidenceRegions = opts.visionSelection?.selectedRegionCount ?? null;
  // Evidence honesty: what visual evidence did the model actually receive? Only an
  // image-bearing call can be an INDEPENDENT visual reconstruction; a zero-image
  // call leans on text anchors and must not be presented as independent.
  const fullPageImages = images.filter((i) => !i.crop);
  out.aiIndependentEvidenceAvailable = images.length > 0;
  out.fullPageFallbackUsed = fullPageImages.length > 0;
  out.fallbackImageCount = fullPageImages.length;
  out.fallbackEvidencePages = [...new Set(fullPageImages.map((i) => i.page))].sort((a, b) => a - b);
  // Prefer the page-evidence PLAN diagnostics (rendered-page strategy) when present;
  // otherwise derive a basic mode from the image crop flags (back-compat).
  if (opts.evidencePlan) {
    const p = opts.evidencePlan;
    out.aiEvidenceMode = images.length === 0 ? "text-only" : p.aiEvidenceMode;
    out.aiEvidenceCoverageLevel = p.aiEvidenceCoverageLevel;
    out.aiEvidenceCompletenessScore = p.aiEvidenceCompletenessScore;
    out.selectedEvidencePages = p.selectedEvidencePages;
    out.selectedEvidencePageCount = p.selectedEvidencePageCount;
    out.pageCoverageRatio = p.pageCoverageRatio;
    out.allPagesFallbackUsed = p.allPagesFallbackUsed;
    out.transactionPagesSelected = p.transactionPagesSelected;
    out.summaryAnchorPagesSelected = p.summaryAnchorPagesSelected;
    out.pagesSkippedCount = p.pagesSkippedCount;
    out.pagesSkippedReasonCounts = p.pagesSkippedReasonCounts;
  } else {
    out.aiEvidenceMode =
      images.length === 0 ? "text-only" : images.every((i) => i.crop) ? "region-crops" : "full-pages";
  }
  out.regionSelectionFailedReason =
    images.length === 0
      ? "no-visual-evidence-rendered"
      : out.fullPageFallbackUsed && !opts.evidencePlan
        ? "no-table-regions-detected-full-page-fallback"
        : null;
  // Safe per-page row counts (only when the row carries a page; never row text).
  const rowsByPage = (txns: Transaction[]): Record<number, number> => {
    const m: Record<number, number> = {};
    for (const t of txns) if (typeof t.page === "number") m[t.page] = (m[t.page] ?? 0) + 1;
    return m;
  };
  out.parserRowsByPage = rowsByPage(statement.transactions);

  const call = opts.call ?? defaultCaller;
  const callStart = Date.now();
  const res = await call({ evidence, images }, config);
  out.aiCallDurationMs = Date.now() - callStart;
  out.attempted = true;
  out.called = true;
  out.aiCallCount = 1;
  out.responseReceived = res.ok || Boolean(res.errorLabel?.startsWith("http-"));
  out.errorLabel = res.errorLabel;
  if (config.debugProviderMeta && res.meta) {
    out.aiInputTokenCount = res.meta.inputTokens;
    out.aiOutputTokenCount = res.meta.outputTokens;
    out.aiTotalTokenCount = res.meta.totalTokens;
    out.aiProviderResponseId = res.meta.responseId;
  }
  if (!res.ok || !res.content) {
    out.status = "call-failed";
    return { outcome: out };
  }

  const parsed = parseAiResponse(res.content);
  if (!parsed) {
    out.status = "invalid-response";
    return { outcome: out };
  }

  // Section-coverage diagnostics (advisory only — they NEVER affect adoption, which
  // stays driven by deterministic reconciliation + quality). Safe tokens/counts/
  // numbers only; section labels are normalized to a fixed vocabulary upstream.
  out.aiSummaryAnchorsUsed = Boolean(
    evidence.expectedSectionTotals &&
      (evidence.expectedSectionTotals.payments !== null ||
        evidence.expectedSectionTotals.charges !== null ||
        evidence.expectedSectionTotals.fees !== null ||
        evidence.expectedSectionTotals.interest !== null),
  ) || Boolean(evidence.detectedSummaryTotals);
  const sc = parsed.sectionCoverage;
  if (sc) {
    out.aiDetectedTransactionSections = sc.detectedTransactionSections;
    out.aiIgnoredNonTransactionSectionsCount = sc.ignoredNonTransactionSections.length;
    out.aiNonTransactionMoneySectionsDetected = sc.ignoredNonTransactionSections.length;
    out.aiSectionTotalsMatched = sc.sectionTotalsMatch;
    out.aiMissingSectionLikely = sc.possibleMissingSection;
    out.aiPossibleMissingAmount = sc.possibleMissingAmount;
    out.aiFeesSectionDetected = sc.detectedTransactionSections.includes("fees");
    out.aiInterestSectionDetected = sc.detectedTransactionSections.includes("interest");
    out.aiPaymentsSectionDetected = sc.detectedTransactionSections.includes("payments");
    out.aiChargesSectionDetected =
      sc.detectedTransactionSections.includes("purchases") ||
      sc.detectedTransactionSections.includes("charges");
  }

  // Apply the deterministic interest/fee repair to a built candidate (closes a
  // credit-card debit shortfall that is exactly the detected current-period
  // interest/fees) so the comparison sees the reconciling version.
  const withInterestFeeRepair = (built: ParsedStatement): { statement: ParsedStatement; rowsAdded: number } => {
    const rep = repairCreditCardInterestFees(built, evidence.creditCardInterestFees, meta);
    return rep.applied ? { statement: rep.statement, rowsAdded: rep.rowsAdded } : { statement: built, rowsAdded: 0 };
  };

  const hasVisionEvidence = images.length > 0;
  // Record safe candidate-quality diagnostics on the outcome (last-evaluated wins,
  // but a "rejected" status is never overwritten by a later "ok").
  const recordQuality = (q: CandidateQuality) => {
    if (out.aiCandidateQualityStatus === "rejected" && q.status !== "rejected") return;
    out.aiAggregateRowsDetected = q.aggregateRows;
    out.aiPlaceholderRowsDetected = q.placeholderRows;
    out.aiCandidateQualityStatus = q.status;
    out.aiCandidateQualityReasons = q.reasons;
    out.aiItemizedRowCount = q.itemizedRows;
    out.aiMissingDateRate = q.missingDateRate;
    out.aiLowConfidenceRowRate = q.lowConfidenceRowRate;
    out.aiLargestRowShareOfDebits = q.largestRowShareOfDebits;
  };
  // A candidate must be made of itemized rows. Reject "fake reconciliation"
  // (aggregate/placeholder/summary rows) so it can never be adopted as reconciled.
  const acceptQuality = (s: ParsedStatement): boolean => {
    const q = evaluateCandidateQuality(s, { hasVisionEvidence });
    recordQuality(q);
    if (q.status === "rejected") {
      out.aiCandidateRejectedForQuality = true;
      if (!out.aiRejectedReason) out.aiRejectedReason = q.reasons[0] ?? "ai-fake-reconciliation-risk";
      return false;
    }
    return true;
  };

  const candidates: Labeled[] = [];
  if (parsed.candidate) {
    const built = buildIndependentCandidate(statement, evidence, parsed.candidate, meta, allowedVisualRefs);
    out.aiIndependentCandidateBuilt = Boolean(built.statement);
    if (built.statement) {
      const fixed = withInterestFeeRepair(built.statement);
      out.aiCandidateDifference = candidateMetrics(fixed.statement).difference;
      // Only an itemized, non-fake candidate is eligible for adoption.
      if (acceptQuality(fixed.statement)) {
        candidates.push({ source: "ai-candidate", statement: fixed.statement, interestFeeRowsAdded: fixed.rowsAdded });
      }
    }
    if (built.rejectedReason && !out.aiRejectedReason) out.aiRejectedReason = built.rejectedReason;
    if (built.sectionIndex !== null) out.aiSelectedSectionIndex = built.sectionIndex;
  }
  if (parsed.repairPlan) {
    const built = applyRepairPlan(statement, evidence, parsed.repairPlan, meta, allowedVisualRefs);
    out.aiRepairPlanBuilt = Boolean(built.statement);
    if (built.statement) {
      const fixed = withInterestFeeRepair(built.statement);
      out.aiRepairPlanDifference = candidateMetrics(fixed.statement).difference;
      if (acceptQuality(fixed.statement)) {
        candidates.push({ source: "ai-repair-plan", statement: fixed.statement, interestFeeRowsAdded: fixed.rowsAdded });
      }
    }
    if (built.rejectedReason && !out.aiRejectedReason) out.aiRejectedReason = built.rejectedReason;
    if (built.sectionIndex !== null && out.aiSelectedSectionIndex === null) {
      out.aiSelectedSectionIndex = built.sectionIndex;
    }
  }

  const parserMetricsEarly = candidateMetrics(statement);
  out.parserRows = parserMetricsEarly.rowCount;
  out.parserDifference = parserMetricsEarly.difference;

  out.candidateComparisonCount = 1 + candidates.length;
  if (candidates.length === 0) {
    out.status = "no-usable-result";
    out.aiAdopted = false;
    out.aiFailureLikelyReason = !out.aiIndependentEvidenceAvailable
      ? "insufficient-evidence"
      : out.aiCandidateRejectedForQuality
        ? "quality-gate"
        : parsed.noSafeReconstruction
          ? "model-missed-rows"
          : "model-missed-rows";
    // When AI declared it cannot safely reconstruct, surface that explicitly.
    if (!out.aiRejectedReason) {
      out.aiRejectedReason = parsed.noSafeReconstruction
        ? "no-safe-reconstruction"
        : evidence.parserLikelyMissedTransactions
          ? "no-transaction-table-candidate"
          : "no-usable-rows";
    }
    out.aiAdoptedReason = out.aiRejectedReason;
    return { outcome: out };
  }

  const best = rankAi(candidates)!;
  const bestMetrics = candidateMetrics(best.statement);
  const parserMetrics = parserMetricsEarly;

  // Safe parser-vs-AI comparison diagnostics (counts/differences only — no row text).
  out.parserCandidateDifference = parserMetrics.difference;
  out.parserCandidateRowCount = parserMetrics.rowCount;
  out.aiCandidateRowCount = bestMetrics.rowCount;
  out.aiReconstructionRows = bestMetrics.rowCount;
  out.aiReconstructionDifference = bestMetrics.difference;
  out.aiReconciled = bestMetrics.status === "passed";
  // Independent VISUAL reconstruction requires BOTH real visual evidence AND a
  // reconciled rebuild. A reconciled rebuild with no images is NOT independent
  // (it leaned on text anchors), so this stays false.
  out.aiIndependentVisualReconstruction = out.aiIndependentEvidenceAvailable && out.aiReconciled;
  out.aiCandidateUnreconciledDifference =
    bestMetrics.status !== "passed" ? bestMetrics.difference : null;
  out.aiRowsByPage = rowsByPage(best.statement.transactions);
  const comparison = compareRowsToParser(statement, best.statement);
  out.aiDroppedParserRowsCount = comparison.dropped;
  out.aiAddedRowsVsParserCount = comparison.added;
  out.aiCorrectedRowsVsParserCount = comparison.corrected;

  const aiReducedDifference =
    parserMetrics.difference !== null &&
    bestMetrics.difference !== null &&
    bestMetrics.difference < parserMetrics.difference - 0.005;
  const aiStillUnreconciled = bestMetrics.status !== "passed";

  // STRICT adoption policy: NEVER auto-apply an AI candidate that is still
  // MEANINGFULLY unreconciled (improving 4445→946 off is still wrong). Adopt only
  // when the candidate (a) fully reconciles, (b) is within a strict residual AND
  // keeps all parser rows, or (c) the parser clearly MISSED the table (near-empty)
  // and AI rebuilt a materially larger itemized set. Otherwise the parser result is
  // kept as the final, honest Needs-review outcome and AI is a suggestion only.
  const STRICT_RESIDUAL = 1.0;
  const fullyReconciled = bestMetrics.status === "passed";
  const nearlyReconciledKeepsRows =
    bestMetrics.difference !== null &&
    bestMetrics.difference <= STRICT_RESIDUAL &&
    bestMetrics.rowCount >= parserMetrics.rowCount;
  const parserMissedTable = parserMetrics.rowCount <= 1;
  const aiRebuiltMuchMore = bestMetrics.rowCount >= parserMetrics.rowCount + 3;
  // A reconstruction that DROPS parser rows is only safe if it recovers the balance
  // (fully or within the strict residual) or the parser clearly missed the table.
  // Otherwise it may be discarding real activity, so keep the parser result.
  const recoversBalance =
    fullyReconciled || (bestMetrics.difference !== null && bestMetrics.difference <= STRICT_RESIDUAL);
  const droppedRowsUnexplained =
    comparison.dropped > 0 && !recoversBalance && !parserMissedTable;
  const strictSafe =
    (fullyReconciled || nearlyReconciledKeepsRows || (parserMissedTable && aiRebuiltMuchMore)) &&
    !droppedRowsUnexplained;

  const beats = candidateBeatsParser(statement, best.statement);
  const adopt = beats && strictSafe;
  if (!adopt) {
    out.applied = true; // a usable candidate was built and validated, just not adopted
    out.status = "no-improvement";
    out.aiAdopted = false;
    if (bestMetrics.rowCount < parserMetrics.rowCount || comparison.dropped > 0) {
      out.parserRowsPreservedOverAiRows = true;
    }
    if (aiReducedDifference && aiStillUnreconciled) {
      out.aiImprovedButStillUnreconciled = true;
      // AI helped the arithmetic but was NOT applied: still unreconciled and it did
      // not clear the strict adoption policy. Keep the parser result.
      if (beats) out.aiImprovedButNotAppliedStillUnreconciled = true;
    }
    // Prefer a specific reason already set by the builder; otherwise say why.
    if (!out.aiRejectedReason) {
      out.aiRejectedReason = !beats
        ? "candidate-worse-than-parser"
        : droppedRowsUnexplained
          ? "ai-drops-parser-rows-without-reconciling"
          : "ai-unreconciled-not-adopted";
    }
    out.aiAdoptedReason = out.aiRejectedReason;
    // Why did AI not succeed? Distinguish incomplete evidence from a model miss so a
    // starved call is never blamed on the model. A candidate that fully reconciled
    // and passed quality but simply was not adopted (e.g. the parser already verified
    // with equal/higher confidence) is NOT a failure → "none".
    out.aiFailureLikelyReason = out.aiCandidateRejectedForQuality
      ? "quality-gate"
      : !out.aiIndependentEvidenceAvailable
        ? "insufficient-evidence"
        : (out.aiEvidenceCompletenessScore !== null && out.aiEvidenceCompletenessScore < 1) ||
            out.aiEvidenceCoverageLevel === "partial"
          ? "insufficient-evidence"
          : aiStillUnreconciled
            ? "model-missed-rows"
            : "none";
    return { outcome: out };
  }

  const bm = bestMetrics;
  // Adopted, but if it did not fully reconcile, flag it so the final state stays
  // Needs review with a clear "improved but not reconciled" signal (the validation
  // status is already non-passed, so the UI never presents it as solved).
  if (bm.status !== "passed") out.aiImprovedButStillUnreconciled = true;
  out.applied = true;
  out.improved = true;
  out.aiAdopted = true;
  out.aiAdoptedReason = fullyReconciled
    ? "ai-full-reconstruction-reconciled"
    : parserMissedTable
      ? "parser-missed-table-ai-rebuilt"
      : "ai-nearly-reconciled-keeps-rows";
  // A candidate was adopted; any rejection reason recorded for the OTHER (unused)
  // candidate is no longer the outcome and would be misleading in diagnostics.
  out.aiRejectedReason = null;
  out.aiFailureLikelyReason = "none";
  out.adoptedCandidateSource = best.source;
  if (best.interestFeeRowsAdded && best.interestFeeRowsAdded > 0) {
    out.interestFeeRepairApplied = true;
    out.interestFeeRowsAdded = best.interestFeeRowsAdded;
  }
  out.postDifference = bm.difference;
  out.improvement =
    out.preDifference !== null && bm.difference !== null ? out.preDifference - bm.difference : null;
  out.status = bm.status === "passed" ? "reconciled" : "improved";
  return { outcome: out, statement: best.statement, rows: parsedStatementToRows(best.statement) };
}

/** A safe, "no call made" outcome for paths where AI never runs (e.g. scanned). */
export function notAttemptedOutcome(
  config: AiAssistConfig,
  status: AiAssistStatus = "not-eligible",
): AiAssistOutcome {
  return {
    eligible: false,
    configured: config.hasKey && Boolean(config.model),
    enabled: config.enabled,
    attempted: false,
    called: false,
    responseReceived: false,
    applied: false,
    improved: false,
    status,
    model: config.model,
    missingConfig: config.missingConfig,
    preDifference: null,
    postDifference: null,
    improvement: null,
    errorLabel: null,
    aiIndependentCandidateBuilt: false,
    aiRepairPlanBuilt: false,
    aiCandidateDifference: null,
    aiRepairPlanDifference: null,
    adoptedCandidateSource: "parser",
    aiSelectedSectionIndex: null,
    aiRejectedReason: null,
    candidateComparisonCount: 1,
    aiFallbackType: "none",
    aiCallCount: 0,
    aiVisionUsed: false,
    aiRenderedPagesCount: 0,
    aiImageCropsCount: 0,
    aiFullPageImagesCount: 0,
    aiInputTokenCount: null,
    aiOutputTokenCount: null,
    aiTotalTokenCount: null,
    aiProviderResponseId: null,
    aiRenderFailedReason: null,
    visionSelection: null,
    aiCallDurationMs: null,
    renderDurationMs: null,
    routeDurationMs: null,
    interestFeeRepairApplied: false,
    interestFeeRowsAdded: 0,
    aiEligibilityReasons: [],
    aiSkippedReason: status === "not-eligible" ? "parser-verified" : null,
    rendererBackendAvailable: null,
    rendererBackendName: null,
    rendererProbeReason: null,
    aiAggregateRowsDetected: 0,
    aiPlaceholderRowsDetected: 0,
    aiCandidateQualityStatus: "not-evaluated",
    aiCandidateQualityReasons: [],
    aiCandidateRejectedForQuality: false,
    aiMissingDateRate: null,
    aiLowConfidenceRowRate: null,
    aiItemizedRowCount: null,
    aiLargestRowShareOfDebits: null,
    aiImprovedButStillUnreconciled: false,
    aiImprovedButNotAppliedStillUnreconciled: false,
    aiCandidateUnreconciledDifference: null,
    parserCandidateDifference: null,
    parserCandidateRowCount: null,
    aiCandidateRowCount: null,
    parserRowsPreservedOverAiRows: false,
    aiMode: "none",
    aiReconstructionRows: null,
    parserRows: null,
    aiDroppedParserRowsCount: null,
    aiAddedRowsVsParserCount: null,
    aiCorrectedRowsVsParserCount: null,
    aiReconstructionDifference: null,
    parserDifference: null,
    aiReconciled: false,
    aiAdopted: false,
    aiAdoptedReason: null,
    aiEvidencePages: [],
    aiEvidenceRegions: null,
    aiInputImageCount: null,
    aiEvidenceMode: "none",
    aiEvidenceCoverageLevel: "none",
    aiEvidenceCompletenessScore: null,
    selectedEvidencePages: [],
    selectedEvidencePageCount: null,
    pageCoverageRatio: null,
    allPagesFallbackUsed: false,
    transactionPagesSelected: [],
    summaryAnchorPagesSelected: [],
    pagesSkippedCount: null,
    pagesSkippedReasonCounts: {},
    aiIndependentEvidenceAvailable: false,
    aiIndependentVisualReconstruction: false,
    regionSelectionFailedReason: null,
    fullPageFallbackUsed: false,
    fallbackImageCount: null,
    fallbackEvidencePages: [],
    aiFailureLikelyReason: "none",
    parserRowsByPage: {},
    aiRowsByPage: {},
    aiVisionEvidence: [],
    aiDetectedTransactionSections: [],
    aiIgnoredNonTransactionSectionsCount: null,
    aiSectionTotalsMatched: null,
    aiMissingSectionLikely: null,
    aiPossibleMissingAmount: null,
    aiSummaryAnchorsUsed: false,
    aiFeesSectionDetected: false,
    aiInterestSectionDetected: false,
    aiPaymentsSectionDetected: false,
    aiChargesSectionDetected: false,
    aiNonTransactionMoneySectionsDetected: null,
  };
}

export type AiAssistResolution = {
  statement: ParsedStatement;
  rows: TransactionRow[];
  outcome: AiAssistOutcome;
};

/** The single route-level AI decision; always returns an outcome (never undefined). */
export async function resolveAiAssist(
  parserStatement: ParsedStatement,
  parserRows: TransactionRow[],
  config: AiAssistConfig,
  meta: BuildStatementMeta = {},
  opts: AiAssistOptions = {},
): Promise<AiAssistResolution> {
  const run = await runAiAssist(parserStatement, config, meta, opts);
  return {
    statement: run.statement ?? parserStatement,
    rows: run.rows ?? parserRows,
    outcome: run.outcome,
  };
}
