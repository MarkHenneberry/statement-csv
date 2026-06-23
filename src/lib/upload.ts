// Domain model and pure helpers for the /upload preview flow.
//
// TODO(launch-blocker): Everything here operates on MOCK data. There is no real
// PDF parser, AI-assisted extraction, OCR, or backend. Before launch the mock
// statement must be replaced by real extraction output, and the "files are
// deleted after conversion" promise made elsewhere must be implemented and
// verified.

export type TransactionRow = {
  id: string;
  date: string;
  description: string;
  debit: number | null;
  credit: number | null;
  // Amount is intentionally NOT stored. It is always derived from debit/credit
  // via deriveAmount() so the two can never disagree. See deriveAmount below.
  balance: number | null;
  category: string;
  /** Model confidence 0..1. Manually added rows are treated as fully trusted. */
  confidence: number;
  /** Optional extra per-row note from extraction (merged into row warnings). */
  warning?: string;
};

export type MockStatement = {
  fileName: string;
  pagesUsed: number;
  openingBalance: number;
  /** The closing balance printed on the statement (used for balance checks). */
  closingBalance: number;
  rows: TransactionRow[];
};

// Bank accounts grow with credits; credit cards grow with debits (charges).
export type BalanceMode = "bank-account" | "credit-card";

export type BalanceCheck = {
  /** False when opening or closing balance is unknown (e.g. not found in PDF). */
  available: boolean;
  mode: BalanceMode;
  openingBalance: number | null;
  totalCredits: number;
  totalDebits: number;
  expectedClosing: number | null;
  statementClosing: number | null;
  difference: number | null;
  passed: boolean;
};

export const LOW_CONFIDENCE_THRESHOLD = 0.7;
export const MAX_FILE_SIZE_MB = 10;
export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

export const PROCESSING_STEPS = [
  "Reading statement",
  "Finding transaction rows",
  "Running balance checks",
  "Preparing preview",
];

export const CSV_HEADERS = [
  "Date",
  "Description",
  "Debit",
  "Credit",
  "Amount",
  "Balance",
  "Category",
];

let idCounter = 0;
export function makeRowId(): string {
  idCounter += 1;
  return `row-${idCounter}-${Math.random().toString(36).slice(2, 7)}`;
}

// Cents-safe helpers: do money arithmetic on integer cents to avoid floating
// point display issues, then convert back to a 2-decimal number.
export function toCents(n: number): number {
  return Math.round(n * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

/**
 * A debit/credit column counts as "filled" only when it holds a real, nonzero
 * amount. A numeric 0 means "this side is empty" (e.g. a credit-card row with a
 * real debit and credit 0) and must NOT be treated as a filled value — otherwise
 * a normal one-sided row is falsely flagged "debit and credit both filled".
 */
export function hasAmount(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v) && Math.abs(v) >= 0.005;
}

/**
 * Normalize a debit/credit field for display + export: a missing or zero value
 * becomes null (blank), so the opposite column is never shown as "0.00".
 */
export function normalizeMoneyField(v: number | null | undefined): number | null {
  return hasAmount(v) ? v : null;
}

/**
 * Derive the signed Amount from debit/credit. Amount is never edited directly.
 * Zero counts as empty (see hasAmount), so debit:228.85/credit:0 is debit-only.
 *  - debit only  -> negative amount
 *  - credit only -> positive amount
 *  - both blank  -> null (blank); row gets a warning elsewhere
 *  - both filled -> null (ambiguous); row gets a warning elsewhere
 */
export function deriveAmount(
  debit: number | null,
  credit: number | null,
): number | null {
  const debitFilled = hasAmount(debit);
  const creditFilled = hasAmount(credit);
  if (debitFilled && creditFilled) return null;
  if (debitFilled) return fromCents(-toCents(debit as number));
  if (creditFilled) return fromCents(toCents(credit as number));
  return null;
}

/** Format a number as money, or an em dash when empty. */
export function formatMoney(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Human-readable file size. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/**
 * Rough page-count placeholder derived from file size.
 * TODO(launch-blocker): real page count requires the PDF parser; this is an
 * estimate only and is labelled as such in the UI.
 */
export function estimatePageCount(bytes: number): number {
  return Math.max(1, Math.round(bytes / (45 * 1024)));
}

export type FileValidation = { ok: true } | { ok: false; reason: string };

export function validateFile(file: File): FileValidation {
  const isPdf =
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) {
    return {
      ok: false,
      reason:
        "That file is not a PDF. Please upload a digital PDF bank statement.",
    };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      ok: false,
      reason: `That file is larger than ${MAX_FILE_SIZE_MB} MB. Try a shorter statement or a single account.`,
    };
  }
  return { ok: true };
}

/**
 * All row-level validation warnings, in display order. An empty array means the
 * row looks clean. These power both the per-row UI and the flagged-row counts.
 */
export function getRowWarnings(row: TransactionRow): string[] {
  const warnings: string[] = [];
  if (!row.date.trim()) warnings.push("Missing date.");
  if (!row.description.trim()) warnings.push("Missing description.");

  // Zero counts as empty, so a normal one-sided row (real debit + credit 0) is
  // NOT flagged "both filled". Both-empty rows are still flagged as missing.
  const debitFilled = hasAmount(row.debit);
  const creditFilled = hasAmount(row.credit);
  if (debitFilled && creditFilled) {
    warnings.push("Debit and credit cannot both be filled.");
  }
  if (!debitFilled && !creditFilled) {
    warnings.push("Add a debit or credit amount.");
  }
  if ((row.debit !== null && (row.debit as number) < 0) || (row.credit !== null && (row.credit as number) < 0)) {
    warnings.push("Money values cannot be negative.");
  }
  if (row.confidence < LOW_CONFIDENCE_THRESHOLD) {
    warnings.push("Low confidence — please review.");
  }
  if (row.warning) warnings.push(row.warning);
  return warnings;
}

export function isRowFlagged(row: TransactionRow): boolean {
  return getRowWarnings(row).length > 0;
}

export function countFlaggedRows(rows: TransactionRow[]): number {
  return rows.filter(isRowFlagged).length;
}

export function countLowConfidence(rows: TransactionRow[]): number {
  return rows.filter((r) => r.confidence < LOW_CONFIDENCE_THRESHOLD).length;
}

// Warnings that, on their own, do NOT block a "verified" conversion (the row is
// usable; the user may still want to glance at it).
const MINOR_ROW_WARNINGS = new Set<string>(["Low confidence — please review."]);

/** Severity of a row's warnings: material issues block verification, minor ones don't. */
export function rowWarningSeverity(row: TransactionRow): "none" | "minor" | "material" {
  const warnings = getRowWarnings(row);
  if (warnings.length === 0) return "none";
  // The row's own extraction note (sourceNote) is advisory, not a hard data error.
  const material = warnings.some(
    (w) => !MINOR_ROW_WARNINGS.has(w) && w !== row.warning,
  );
  return material ? "material" : "minor";
}

/** Count rows by warning severity — drives the conversion presentation state. */
export function countRowWarningSeverity(rows: TransactionRow[]): { material: number; minor: number } {
  let material = 0;
  let minor = 0;
  for (const row of rows) {
    const sev = rowWarningSeverity(row);
    if (sev === "material") material += 1;
    else if (sev === "minor") minor += 1;
  }
  return { material, minor };
}

export function computeBalanceCheck(
  openingBalance: number | null,
  statementClosing: number | null,
  rows: TransactionRow[],
  mode: BalanceMode = "bank-account",
): BalanceCheck {
  // Sum in integer cents so totals never drift from floating point error.
  const creditCents = rows.reduce(
    (sum, r) => sum + (r.credit !== null ? toCents(r.credit) : 0),
    0,
  );
  const debitCents = rows.reduce(
    (sum, r) => sum + (r.debit !== null ? toCents(r.debit) : 0),
    0,
  );

  // Without an opening balance we cannot project a closing balance, and without
  // a statement closing balance we have nothing to compare against.
  const available = openingBalance !== null && statementClosing !== null;
  // Bank account: opening + credits - debits. Credit card: opening + debits - credits.
  const netCents = mode === "credit-card" ? debitCents - creditCents : creditCents - debitCents;
  const expectedCents = openingBalance !== null ? toCents(openingBalance) + netCents : null;
  const diffCents =
    expectedCents !== null && statementClosing !== null
      ? expectedCents - toCents(statementClosing)
      : null;

  return {
    available,
    mode,
    openingBalance,
    totalCredits: fromCents(creditCents),
    totalDebits: fromCents(debitCents),
    expectedClosing: expectedCents !== null ? fromCents(expectedCents) : null,
    statementClosing,
    difference: diffCents !== null ? fromCents(diffCents) : null,
    // Exact to the cent. A sanity check, not a guarantee of accuracy.
    passed: diffCents !== null && diffCents === 0,
  };
}

/** User-facing balance-check states (mirrors the summary card badge). */
export type EffectiveBalanceStatus = "passed" | "review" | "limited";

/**
 * The user-facing balance status MUST reflect the full validation engine, not
 * just the arithmetic identity. The arithmetic check can be trivially "passed"
 * (e.g. opening == closing with zero parsed activity) while the validation engine
 * has already determined the parse missed the statement's summary activity. In
 * that case the user must see "Needs review", never "Passed". The stronger signal
 * always wins: validation "needs-review" downgrades a passed arithmetic check;
 * validation "limited" or a missing balance shows "Limited".
 */
export function resolveBalanceStatus(
  check: Pick<BalanceCheck, "available" | "passed">,
  validationStatus?: "passed" | "needs-review" | "limited",
): EffectiveBalanceStatus {
  // The validation engine is the source of truth. If it says the parse needs
  // review, that overrides a coincidentally-balancing arithmetic identity.
  if (validationStatus === "needs-review") return "review";
  if (!check.available) return "limited";
  if (validationStatus === "limited") return "limited";
  return check.passed ? "passed" : "review";
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function csvNumber(value: number | null): string {
  return value === null || Number.isNaN(value) ? "" : value.toFixed(2);
}

/** Serialize the current rows to CSV text using the export column order. */
export function rowsToCsv(rows: TransactionRow[]): string {
  const lines = [CSV_HEADERS.join(",")];
  for (const r of rows) {
    lines.push(
      [
        csvCell(r.date),
        csvCell(r.description),
        csvNumber(r.debit),
        csvNumber(r.credit),
        // Amount always reflects the derived debit/credit value.
        csvNumber(deriveAmount(r.debit, r.credit)),
        csvNumber(r.balance),
        csvCell(r.category),
      ].join(","),
    );
  }
  return lines.join("\r\n");
}

export function blankRow(): TransactionRow {
  return {
    id: makeRowId(),
    date: "",
    description: "",
    debit: null,
    credit: null,
    balance: null,
    category: "",
    confidence: 1,
  };
}

/**
 * Build a fresh mock statement. New ids are generated every call so editing the
 * preview never mutates a shared array.
 *
 * TODO(launch-blocker): replace with real extracted data from the parser.
 */
export function createMockStatement(
  fileName = "bank-statement.pdf",
  pagesUsed = 4,
): MockStatement {
  const openingBalance = 2000.0;
  const seed: Omit<TransactionRow, "id">[] = [
    { date: "2024-05-02", description: "Payroll Deposit", debit: null, credit: 2200.0, balance: 4200.0, category: "Income", confidence: 0.99 },
    { date: "2024-05-03", description: "Grocery Mart #214", debit: 84.2, credit: null, balance: 4115.8, category: "Groceries", confidence: 0.97 },
    { date: "2024-05-05", description: "Coffee Roasters", debit: 5.75, credit: null, balance: 4110.05, category: "Dining", confidence: 0.92 },
    { date: "2024-05-07", description: "Hydro One Pre-Auth", debit: 142.5, credit: null, balance: 3967.55, category: "Utilities", confidence: 0.95 },
    { date: "2024-05-09", description: "e-Transfer Received", debit: null, credit: 300.0, balance: 4267.55, category: "Transfer", confidence: 0.88 },
    { date: "2024-05-12", description: "AMZN Mktp CA*2X9", debit: 56.13, credit: null, balance: 4211.42, category: "Shopping", confidence: 0.61 },
    { date: "2024-05-15", description: "Rent Payment", debit: 1500.0, credit: null, balance: 2711.42, category: "Housing", confidence: 0.98 },
    { date: "2024-05-18", description: "Restaurant (unclear)", debit: 73.4, credit: null, balance: 2638.02, category: "Dining", confidence: 0.54, warning: "Description may be incomplete — please review." },
    { date: "2024-05-22", description: "Interest Earned", debit: null, credit: 1.25, balance: 2639.27, category: "Income", confidence: 0.9 },
    { date: "2024-05-28", description: "Phone Bill Pre-Auth", debit: 65.0, credit: null, balance: 2574.27, category: "Utilities", confidence: 0.96 },
  ];

  const rows: TransactionRow[] = seed.map((r) => ({
    ...r,
    id: makeRowId(),
  }));

  return {
    fileName,
    pagesUsed,
    openingBalance,
    closingBalance: 2574.27,
    rows,
  };
}
