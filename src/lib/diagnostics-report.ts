// Internal-tester diagnostic summary: SAFE aggregate fields only.
//
// This module is pure (no DB, no network, no secrets) so it is shared by the client
// (to display/copy) and the server route (to RE-sanitize before emailing). The whole
// point is to help find parser/AI edge cases WITHOUT ever moving private statement
// content: every field here is a count, status label, boolean, or short safe code.
// The builder is a strict whitelist — anything not explicitly allowed is dropped, so
// even a malicious/buggy client cannot smuggle descriptions, rows, or prompts through.

export type DiagnosticStatus = "verified" | "review" | "failed" | "unknown";
export type DiagnosticSource = "parser" | "ai-assisted" | "fallback-attempted";

/** Loosely-typed input as received from the client (every field optional/untrusted). */
export type DiagnosticSummaryInput = {
  conversionId?: unknown;
  status?: unknown;
  source?: unknown;
  aiUsed?: unknown;
  aiFallbackAttempted?: unknown;
  pageCount?: unknown;
  rowCount?: unknown;
  parserWarningCount?: unknown;
  rowWarningCount?: unknown;
  balanceStatus?: unknown;
  balanceDifference?: unknown;
  safeErrorCode?: unknown;
  creditsUsed?: unknown;
};

/** The sanitized, safe-to-send shape. */
export type SafeDiagnosticSummary = {
  conversionId: string | null;
  status: DiagnosticStatus;
  source: DiagnosticSource;
  aiUsed: boolean;
  aiFallbackAttempted: boolean;
  pageCount: number | null;
  rowCount: number;
  parserWarningCount: number;
  rowWarningCount: number;
  balanceStatus: string | null;
  balanceDifference: number | null;
  safeErrorCode: string | null;
  creditsUsed: number | null;
};

const STATUSES: DiagnosticStatus[] = ["verified", "review", "failed", "unknown"];
const SOURCES: DiagnosticSource[] = ["parser", "ai-assisted", "fallback-attempted"];
// Balance-check labels we are willing to echo (aggregate, already shown to the user).
const BALANCE_LABELS = new Set(["passed", "review", "needs-review", "limited", "unknown"]);

const toBool = (v: unknown): boolean => v === true;

/** Non-negative integer count, clamped; non-numeric/garbage → 0. */
const toCount = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
};

/** Nullable integer (e.g. pageCount/creditsUsed); non-numeric → null. */
const toIntOrNull = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

/** Nullable money value rounded to cents; non-numeric → null. */
const toMoneyOrNull = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

/** Short, code-shaped string only ([a-z0-9_-], ≤40 chars). Blocks free text. */
const toSafeCode = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  return /^[a-z0-9_-]{1,40}$/.test(s) ? s : null;
};

/** cuid-shaped id only ([a-z0-9], ≤40). Blocks anything else. */
const toSafeId = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return /^[a-z0-9]{1,40}$/i.test(s) ? s : null;
};

/**
 * Build the safe summary from untrusted input by whitelisting every field. Source is
 * normalized (or derived from the AI booleans when missing). NOTHING outside these
 * keys is ever carried forward.
 */
export function buildSafeDiagnosticSummary(input: DiagnosticSummaryInput): SafeDiagnosticSummary {
  const aiUsed = toBool(input.aiUsed);
  const aiFallbackAttempted = toBool(input.aiFallbackAttempted);

  const rawStatus = typeof input.status === "string" ? input.status.toLowerCase() : "";
  const status = (STATUSES as string[]).includes(rawStatus) ? (rawStatus as DiagnosticStatus) : "unknown";

  const rawSource = typeof input.source === "string" ? input.source.toLowerCase() : "";
  const source: DiagnosticSource = (SOURCES as string[]).includes(rawSource)
    ? (rawSource as DiagnosticSource)
    : aiUsed
      ? "ai-assisted"
      : aiFallbackAttempted
        ? "fallback-attempted"
        : "parser";

  const rawBalance =
    typeof input.balanceStatus === "string" ? input.balanceStatus.toLowerCase() : "";
  const balanceStatus = BALANCE_LABELS.has(rawBalance) ? rawBalance : null;

  return {
    conversionId: toSafeId(input.conversionId),
    status,
    source,
    aiUsed,
    aiFallbackAttempted,
    pageCount: toIntOrNull(input.pageCount),
    rowCount: toCount(input.rowCount),
    parserWarningCount: toCount(input.parserWarningCount),
    rowWarningCount: toCount(input.rowWarningCount),
    balanceStatus,
    balanceDifference: toMoneyOrNull(input.balanceDifference),
    safeErrorCode: toSafeCode(input.safeErrorCode),
    creditsUsed: toIntOrNull(input.creditsUsed),
  };
}

/**
 * A conversion is "flagged" (worth a diagnostic) when it used AI, attempted an AI
 * fallback, needs review, failed, has parser/row warnings, shows a balance mismatch,
 * or carries a safe error code.
 */
export function isFlaggedDiagnostic(s: SafeDiagnosticSummary): boolean {
  const balanceMismatch =
    s.balanceStatus === "review" ||
    s.balanceStatus === "needs-review" ||
    (s.balanceDifference !== null && Math.abs(s.balanceDifference) >= 0.005);
  return (
    s.aiUsed ||
    s.aiFallbackAttempted ||
    s.status === "review" ||
    s.status === "failed" ||
    s.parserWarningCount > 0 ||
    s.rowWarningCount > 0 ||
    balanceMismatch ||
    Boolean(s.safeErrorCode)
  );
}

/** Render the summary as a plain-text block (used for the email body + copy button). */
export function formatDiagnosticSummary(
  s: SafeDiagnosticSummary,
  meta: { testerEmail: string; timestamp: string; environmentLabel: string },
): string {
  const lines = [
    "StatementCSV diagnostic summary (internal)",
    "—",
    `timestamp: ${meta.timestamp}`,
    `tester: ${meta.testerEmail}`,
    `environment: ${meta.environmentLabel}`,
    `conversionId: ${s.conversionId ?? "—"}`,
    `status: ${s.status}`,
    `source: ${s.source}`,
    `aiUsed: ${s.aiUsed ? "yes" : "no"}`,
    `aiFallbackAttempted: ${s.aiFallbackAttempted ? "yes" : "no"}`,
    `pageCount: ${s.pageCount ?? "—"}`,
    `rowCount: ${s.rowCount}`,
    `parserWarningCount: ${s.parserWarningCount}`,
    `rowWarningCount: ${s.rowWarningCount}`,
    `balanceStatus: ${s.balanceStatus ?? "—"}`,
    `balanceDifference: ${s.balanceDifference ?? "—"}`,
    `safeErrorCode: ${s.safeErrorCode ?? "—"}`,
    `creditsUsed: ${s.creditsUsed ?? "—"}`,
  ];
  return lines.join("\n");
}
