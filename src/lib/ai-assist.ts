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

import { LOW_CONFIDENCE_THRESHOLD } from "./upload.ts";
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
import type { VisionImage } from "./pdf-render.ts";

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

/** AI assist is eligible ONLY when the parser result needs help. */
export function isAiAssistEligible(statement: ParsedStatement): boolean {
  const v = statement.validation;
  if (v.status !== "passed") return true;
  if (v.confidence < LOW_CONFIDENCE_THRESHOLD) return true;
  if (statement.statementKind === "unknown") return true;
  if (statement.transactions.length === 0) return true;
  return statement.transactions.some(
    (t) => !t.transactionDate || !t.description.trim() || (t.debit === undefined && t.credit === undefined),
  );
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
  /** Account-section candidates (multi-account statements). */
  accountSections: { index: number; label: string; opening: number | null; closing: number | null; txCount: number }[];
  /** Per-candidate parser summaries (from scoring). */
  candidateSummaries: { name: string; rowCount: number; totalDebits: number; totalCredits: number; balanceStatus: string; difference: number | null }[];
  /** Compact transaction-region lines (NOT full document text). */
  regionLines: string[];
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

  return {
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
    transactions: statement.transactions.map((t) => ({
      transactionDate: t.transactionDate ?? null,
      postingDate: t.postingDate ?? null,
      description: t.description,
      debit: t.debit ?? null,
      credit: t.credit ?? null,
      amount: t.amount,
      balance: t.balance ?? null,
    })),
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

export type AiResponse = {
  candidate?: Record<string, unknown>;
  repairPlan?: Record<string, unknown>;
};

/** Parse the dual-mode response: an independent candidate and/or a repair plan. */
export function parseAiResponse(jsonText: string): AiResponse | null {
  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!isObj(data)) return null;
  const candidate = isObj(data.candidate) ? data.candidate : undefined;
  const repairPlan = isObj(data.repairPlan) ? data.repairPlan : undefined;
  if (!candidate && !repairPlan) return null;
  return { candidate, repairPlan };
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
  if (!txns) return { rejectedReason: "no-usable-rows", sectionIndex };

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

// ----- Candidate comparison & adoption -----

export type CandidateMetrics = {
  status: ParsedStatement["validation"]["status"];
  difference: number | null;
  rowCount: number;
  confidence: number;
  issueCount: number;
};

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

/** Does `cand` reconcile, or materially improve over `parser` without new issues? */
export function candidateBeatsParser(parser: ParsedStatement, cand: ParsedStatement): boolean {
  const p = candidateMetrics(parser);
  const c = candidateMetrics(cand);
  if (c.status === "passed" && p.status !== "passed") return true;
  if (c.status === "passed" && p.status === "passed") return c.confidence > p.confidence + 1e-9;
  if (p.difference !== null && c.difference !== null) {
    if (c.difference < p.difference - 0.005 && c.issueCount <= p.issueCount) return true;
  }
  if (c.confidence > p.confidence + 1e-9 && (c.difference ?? Infinity) <= (p.difference ?? Infinity)) return true;
  return false;
}

type Labeled = { source: AdoptedCandidateSource; statement: ParsedStatement };
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

const SYSTEM_PROMPT =
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
  "for unknown fields.";

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
  for (const img of images) userContent.push({ type: "image_url", image_url: { url: img.dataUrl } });
  const model = images.length > 0 ? (config.visionModel ?? config.model) : config.model;
  return callOpenAiChat(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: images.length > 0 ? userContent : JSON.stringify(evidence) },
    ],
    config,
    { jsonMode: true, model: model ?? undefined },
  );
};

export type AiAssistOptions = {
  evidence?: Partial<AiEvidence>;
  /** Rendered vision images (crops/pages). When present the call is multimodal. */
  images?: VisionImage[];
  /** Why vision rendering produced no images (surfaced in diagnostics). */
  renderFailedReason?: string | null;
  call?: ChatCaller;
  env?: NodeJS.ProcessEnv;
};

function baseOutcome(statement: ParsedStatement, config: AiAssistConfig): AiAssistOutcome {
  const d = statement.validation.difference;
  return {
    eligible: isAiAssistEligible(statement),
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

  const call = opts.call ?? defaultCaller;
  const res = await call({ evidence, images }, config);
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

  const candidates: Labeled[] = [];
  if (parsed.candidate) {
    const built = buildIndependentCandidate(statement, evidence, parsed.candidate, meta, allowedVisualRefs);
    out.aiIndependentCandidateBuilt = Boolean(built.statement);
    if (built.statement) {
      out.aiCandidateDifference = candidateMetrics(built.statement).difference;
      candidates.push({ source: "ai-candidate", statement: built.statement });
    }
    if (built.rejectedReason) out.aiRejectedReason = built.rejectedReason;
    if (built.sectionIndex !== null) out.aiSelectedSectionIndex = built.sectionIndex;
  }
  if (parsed.repairPlan) {
    const built = applyRepairPlan(statement, evidence, parsed.repairPlan, meta, allowedVisualRefs);
    out.aiRepairPlanBuilt = Boolean(built.statement);
    if (built.statement) {
      out.aiRepairPlanDifference = candidateMetrics(built.statement).difference;
      candidates.push({ source: "ai-repair-plan", statement: built.statement });
    }
    if (built.rejectedReason && !out.aiRejectedReason) out.aiRejectedReason = built.rejectedReason;
    if (built.sectionIndex !== null && out.aiSelectedSectionIndex === null) {
      out.aiSelectedSectionIndex = built.sectionIndex;
    }
  }

  out.candidateComparisonCount = 1 + candidates.length;
  if (candidates.length === 0) {
    out.status = "no-usable-result";
    return { outcome: out };
  }

  const best = rankAi(candidates)!;
  const adopt = candidateBeatsParser(statement, best.statement);
  if (!adopt) {
    out.applied = true; // a usable candidate was built and validated, just not better
    out.status = "no-improvement";
    return { outcome: out };
  }

  const bm = candidateMetrics(best.statement);
  out.applied = true;
  out.improved = true;
  out.adoptedCandidateSource = best.source;
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
