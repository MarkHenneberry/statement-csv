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
  blankRow,
  toCents,
  LOW_CONFIDENCE_THRESHOLD,
} from "./upload.ts";
import type { ParseResult, StatementKind, LayoutParseStats } from "./parser.ts";

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
  row.debit = t.debit ?? null;
  row.credit = t.credit ?? null;
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

  // Summary totals printed on the statement vs the parsed totals.
  const sum = result.summary;
  if (sum.credits !== null && Math.abs(toCents(check.totalCredits) - toCents(sum.credits)) > 1) {
    issues.push("Parsed credits do not match the statement's summary total.");
    confidence -= 0.15;
  }
  if (sum.debits !== null && Math.abs(toCents(check.totalDebits) - toCents(sum.debits)) > 1) {
    issues.push("Parsed debits do not match the statement's summary total.");
    confidence -= 0.15;
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
