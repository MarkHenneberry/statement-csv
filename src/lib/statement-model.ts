// Canonical internal statement model.
//
// This is THE domain model the app reasons about: PDF → extracted text/layout →
// ParsedStatement → validation/confidence → CSV/Excel export. The low-level
// `ParseResult` from parser.ts (extraction + heuristics) is adapted into this
// normalized model by `buildParsedStatement`. Export and the editable preview
// derive their rows from `ParsedStatement.transactions` via
// `parsedStatementToRows` — never from raw text.
//
// PRIVACY: this model intentionally has NO rawText field. Raw text/lines exist
// only transiently inside the extractor/parser and are never placed on the
// model, returned to the browser, shown in diagnostics, logged, or exported.

import {
  type TransactionRow,
  type BalanceMode,
  computeBalanceCheck,
  deriveAmount,
  getRowWarnings,
  normalizeMoneyField,
  blankRow,
  toCents,
  LOW_CONFIDENCE_THRESHOLD,
  isAggregateOrPlaceholderDescription,
} from "./upload.ts";
import type { ParseResult, StatementKind, LayoutFamily, LayoutParseStats } from "./parser.ts";

export type Transaction = {
  transactionDate?: string;
  postingDate?: string;
  description: string;
  debit?: number;
  credit?: number;
  /** Signed amount derived from debit/credit (negative = debit). */
  amount: number;
  balance?: number;
  category?: string;
  page?: number;
  confidence: number;
  issues: string[];
  // Internal-only round-trip aids (not exported/serialized as content):
  /** Stable id for the editable preview table. */
  id?: string;
  /** Original extraction note carried from the row, if any. */
  sourceNote?: string;
};

export type SummaryTotals = {
  totalDebits?: number;
  totalCredits?: number;
  totalPurchases?: number;
  totalPayments?: number;
  totalWithdrawals?: number;
  totalDeposits?: number;
};

export type StatementValidationStatus = "passed" | "needs-review" | "limited";

export type StatementValidation = {
  status: StatementValidationStatus;
  /** 0..1 overall confidence in the parse. */
  confidence: number;
  issues: string[];
  /** Reconciliation difference (expected − statement closing), when available. */
  difference?: number;
};

export type ParsedStatement = {
  institution?: string;
  accountName?: string;
  accountNumber?: string;
  periodStart?: string;
  periodEnd?: string;
  statementKind: StatementKind;
  layoutFamily?: string;
  openingBalance?: number;
  closingBalance?: number;
  summaryTotals?: SummaryTotals;
  transactions: Transaction[];
  validation: StatementValidation;
  /** True when AI-assisted repair produced these transactions (re-validated). */
  aiAssisted?: boolean;
  /** Safe aggregate diagnostics only (counts/labels; no raw content). */
  diagnostics?: LayoutParseStats;
};

export type BuildStatementMeta = {
  fileName?: string;
  pageCount?: number;
  periodStart?: string;
  periodEnd?: string;
  institution?: string;
  accountName?: string;
  accountNumber?: string;
};

function balanceMode(kind: StatementKind): BalanceMode {
  return kind === "credit-card" ? "credit-card" : "bank-account";
}

/** Build a canonical Transaction from an extraction row (Stage H normalize). */
function transactionFromRow(row: TransactionRow): Transaction {
  const amount = deriveAmount(row.debit, row.credit);
  return {
    transactionDate: row.date || undefined,
    description: row.description,
    debit: row.debit ?? undefined,
    credit: row.credit ?? undefined,
    amount: amount ?? 0,
    balance: row.balance ?? undefined,
    category: row.category || undefined,
    confidence: row.confidence,
    // getRowWarnings already covers missing date/description/amount, ambiguous
    // direction, negative money, low confidence, and the extraction note.
    issues: getRowWarnings(row),
    id: row.id,
    sourceNote: row.warning,
  };
}

/** Map a canonical Transaction back to an editable preview row (export source). */
export function transactionToRow(t: Transaction): TransactionRow {
  const row = blankRow();
  row.id = t.id ?? row.id;
  row.date = t.transactionDate ?? "";
  row.description = t.description;
  // A zero debit/credit means "this side is empty" — store null so the opposite
  // column never renders/exports as "0.00" and the row isn't falsely flagged.
  row.debit = normalizeMoneyField(t.debit);
  row.credit = normalizeMoneyField(t.credit);
  row.balance = t.balance ?? null;
  row.category = t.category ?? "";
  row.confidence = t.confidence;
  if (t.sourceNote) row.warning = t.sourceNote;
  return row;
}

/** Rows for the editable preview + CSV/Excel export, derived from the model. */
export function parsedStatementToRows(statement: ParsedStatement): TransactionRow[] {
  return statement.transactions.map(transactionToRow);
}

function buildSummaryTotals(result: ParseResult): SummaryTotals | undefined {
  const { credits, debits } = result.summary;
  if (credits === null && debits === null) return undefined;
  const totals: SummaryTotals = {};
  if (debits !== null) totals.totalDebits = debits;
  if (credits !== null) totals.totalCredits = credits;
  if (result.statementKind === "credit-card") {
    if (debits !== null) totals.totalPurchases = debits;
    if (credits !== null) totals.totalPayments = credits;
  } else {
    if (debits !== null) totals.totalWithdrawals = debits;
    if (credits !== null) totals.totalDeposits = credits;
  }
  return totals;
}

/**
 * Stage I: validation + first-class confidence. Reconciliation is the backbone;
 * confidence is reduced for missing balances, non-reconciliation, fallback-only
 * parses, summary-total mismatches, and low-confidence/incomplete rows. An
 * uncertain parse is surfaced as needs-review/limited rather than silently good.
 */
function buildValidation(
  result: ParseResult,
  transactions: Transaction[],
): StatementValidation {
  const rows = result.rows;
  const mode = balanceMode(result.statementKind);
  const check = computeBalanceCheck(
    result.openingBalance,
    result.closingBalance,
    rows,
    mode,
  );

  const issues: string[] = [];
  let confidence = 1;

  if (transactions.length === 0) {
    issues.push("No transaction rows were detected.");
    confidence = 0.1;
  }
  if (result.openingBalance === null || result.closingBalance === null) {
    issues.push("Opening or closing statement balance was not found.");
    confidence -= 0.3;
  }

  let status: StatementValidationStatus;
  if (!check.available) {
    status = "limited";
  } else if (check.passed) {
    status = "passed";
  } else {
    status = "needs-review";
    const off = Math.abs(check.difference ?? 0);
    issues.push(`Balance check did not reconcile (off by ${off.toFixed(2)}).`);
    confidence -= off >= 10 ? 0.4 : 0.2;
  }

  // Source quality: fallback (line parser) is the least trustworthy path.
  const source = result.parseStats?.chosenCandidateSource;
  if (source === "fallback") {
    issues.push("Rows came from the fallback parser, not a detected table.");
    confidence -= 0.2;
  }

  // Summary totals printed on the statement vs the parsed totals. The
  // reconciliation identity (opening +/- credits/debits = closing) can be
  // INTERNALLY true yet EXTERNALLY wrong when parsed activity is ~0 but the
  // statement's own summary shows real activity (e.g. opening==closing==new
  // balance with no parsed rows). That is a false pass — downgrade it.
  const sum = result.summary;
  const meaningful = (v: number | null): v is number => typeof v === "number" && Math.abs(v) >= 0.01;
  // A GROSS mismatch: parsed total is ~0 while the summary is meaningful, or the
  // gap is both > $1 and > 25% of the summary total (tolerates detection noise so
  // a fully-parsed statement whose totals match is unaffected).
  const grossMismatch = (parsed: number, summaryV: number | null): boolean => {
    if (!meaningful(summaryV)) return false;
    const diff = Math.abs(parsed - summaryV);
    return diff > 1 && (Math.abs(parsed) < 0.01 || diff > Math.abs(summaryV) * 0.25);
  };
  const credGross = grossMismatch(check.totalCredits, sum.credits);
  const debGross = grossMismatch(check.totalDebits, sum.debits);
  const summaryActivity = meaningful(sum.credits) || meaningful(sum.debits);
  // Low-row guard: a single/zero row with NEAR-ZERO parsed activity cannot
  // represent a statement whose summary shows real activity (the exact false-pass
  // shape reported: a lone warning/legal line, no debits/credits). A genuine
  // single-transaction statement whose row DOES carry the activity is left to the
  // gross-mismatch check above, so it is not penalised here.
  const parsedActivityNearZero =
    Math.abs(check.totalCredits) < 0.01 && Math.abs(check.totalDebits) < 0.01;
  const lowRowVsSummary = summaryActivity && rows.length <= 1 && parsedActivityNearZero;

  // A genuinely reconciled, itemized parse: the balances reconcile EXACTLY (diff 0)
  // against the statement's OWN opening/closing, parsed activity is meaningful (not
  // the near-zero false-pass shape), and the rows are real itemized transactions
  // (not aggregate/summary/placeholder plugs). In that case a gap against a
  // DETECTED summary total is far more likely a mis-detected/partial summary label
  // (e.g. "Total charges" vs "Total purchases") than missing transactions, so it
  // must NOT hard-downgrade to needs-review nor carry a "transactions appear to be
  // missing" issue. This keeps final validation consistent with a selected
  // candidate that already reconciles. The near-zero / lone-row false-pass shape is
  // excluded here and still hard-downgraded below.
  const itemizedCount = transactions.filter(
    (t) => !isAggregateOrPlaceholderDescription(t.description),
  ).length;
  const reconciledItemized =
    check.available && check.passed && !parsedActivityNearZero && itemizedCount >= 2;

  if (!reconciledItemized && (credGross || debGross || lowRowVsSummary)) {
    // Hard downgrade: never report "passed" when the parse missed the activity
    // the statement summary describes. Forces needs-review and AI fallback.
    status = "needs-review";
    issues.push("Parsed activity does not match the statement summary totals; transactions appear to be missing.");
    confidence = Math.min(confidence, 0.4) - 0.1;
  } else if (!reconciledItemized) {
    // Minor mismatch (both totals present and close-ish): confidence only.
    if (meaningful(sum.credits) && Math.abs(toCents(check.totalCredits) - toCents(sum.credits)) > 1) {
      issues.push("Parsed credits do not exactly match the statement's summary total.");
      confidence -= 0.15;
    }
    if (meaningful(sum.debits) && Math.abs(toCents(check.totalDebits) - toCents(sum.debits)) > 1) {
      issues.push("Parsed debits do not exactly match the statement's summary total.");
      confidence -= 0.15;
    }
  } else {
    // Reconciled itemized parse: balances match the statement exactly. A gap to a
    // detected summary LABEL is a small confidence acknowledgement only — never a
    // needs-review downgrade and never a stale "transactions missing" issue.
    const credSummaryGap =
      meaningful(sum.credits) && Math.abs(toCents(check.totalCredits) - toCents(sum.credits)) > 1;
    const debSummaryGap =
      meaningful(sum.debits) && Math.abs(toCents(check.totalDebits) - toCents(sum.debits)) > 1;
    if (credSummaryGap || debSummaryGap) confidence -= 0.05;
  }

  // Row-level contamination: incomplete or low-confidence rows.
  if (transactions.length > 0) {
    const flagged = transactions.filter((t) => t.issues.length > 0).length;
    const lowConf = transactions.filter((t) => t.confidence < LOW_CONFIDENCE_THRESHOLD).length;
    confidence -= Math.min(0.3, (flagged / transactions.length) * 0.3);
    confidence -= Math.min(0.2, (lowConf / transactions.length) * 0.2);
  }

  return {
    status,
    confidence: Math.max(0, Math.min(1, Number(confidence.toFixed(2)))),
    issues,
    difference: check.difference ?? undefined,
  };
}

/**
 * Adapt a low-level ParseResult into the canonical ParsedStatement model. Pure
 * and deterministic; performs Stages H (normalize transactions) and I (validate)
 * of the pipeline. Raw text never reaches this layer.
 */
/**
 * Build a ParsedStatement from AI-repaired transactions, then run the SAME
 * validation engine again. Balances/summary stay from the original parser (AI
 * repairs rows, it does not invent statement balances); the result is flagged
 * `aiAssisted` and must still go through the review screen before export.
 */
export function buildAiAssistedStatement(
  base: ParsedStatement,
  aiTransactions: Transaction[],
  meta: BuildStatementMeta = {},
): ParsedStatement {
  const rows = aiTransactions.map(transactionToRow);
  const result: ParseResult = {
    statementKind: base.statementKind,
    layoutFamily: (base.layoutFamily as LayoutFamily) ?? "unknown",
    rows,
    openingBalance: base.openingBalance ?? null,
    closingBalance: base.closingBalance ?? null,
    summary: {
      credits: base.summaryTotals?.totalCredits ?? null,
      debits: base.summaryTotals?.totalDebits ?? null,
    },
    warnings: [],
  };
  const statement = buildParsedStatement(result, meta);
  statement.aiAssisted = true;
  return statement;
}

/**
 * Build + validate a ParsedStatement from explicit parts (rows + chosen
 * balances/summary). Used to turn an AI candidate or repair-plan result into a
 * comparable, RE-VALIDATED ParsedStatement using the same validation engine.
 */
export function buildStatementFromRows(
  rows: TransactionRow[],
  parts: {
    statementKind: StatementKind;
    layoutFamily?: string;
    openingBalance: number | null;
    closingBalance: number | null;
    summary?: { credits: number | null; debits: number | null };
  },
  meta: BuildStatementMeta = {},
): ParsedStatement {
  const result: ParseResult = {
    statementKind: parts.statementKind,
    layoutFamily: (parts.layoutFamily as LayoutFamily) ?? "unknown",
    rows,
    openingBalance: parts.openingBalance,
    closingBalance: parts.closingBalance,
    summary: parts.summary ?? { credits: null, debits: null },
    warnings: [],
  };
  return buildParsedStatement(result, meta);
}

export function buildParsedStatement(
  result: ParseResult,
  meta: BuildStatementMeta = {},
): ParsedStatement {
  const transactions = result.rows.map(transactionFromRow);
  const validation = buildValidation(result, transactions);
  return {
    institution: meta.institution,
    accountName: meta.accountName,
    accountNumber: meta.accountNumber,
    periodStart: meta.periodStart,
    periodEnd: meta.periodEnd,
    statementKind: result.statementKind,
    layoutFamily: result.layoutFamily,
    openingBalance: result.openingBalance ?? undefined,
    closingBalance: result.closingBalance ?? undefined,
    summaryTotals: buildSummaryTotals(result),
    transactions,
    validation,
    diagnostics: result.parseStats,
  };
}
