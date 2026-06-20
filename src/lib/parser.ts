// Pure, dependency-free statement-parsing heuristics.
//
// Everything here is deterministic and side-effect free so it can be unit
// tested later without a PDF or a server. The Node-only PDF text extraction
// lives in src/lib/pdf-extract.ts; this file only turns already-extracted text
// into rows.
//
// TODO(launch-blocker): These heuristics are an MVP prototype. They have NOT
// been validated against a representative set of real bank statements. Parser
// accuracy testing (precision/recall on known statements) is required before
// launch. Prefer warnings and lower confidence over guessing.

import type { TransactionRow } from "@/lib/upload";

export type StatementKind = "credit-card" | "bank-account" | "unknown";

/**
 * Safe aggregate counters about credit-card parsing. Counts and statuses only —
 * never raw statement text, descriptions, amounts, or account numbers.
 */
export type CreditCardParseStats = {
  transactionSectionDetected: boolean;
  sameLineDateRows: number;
  splitLineDateRows: number;
  amountLinesDetected: number;
  referenceLinesIgnored: number;
  blocksAttempted: number;
  blocksCompleted: number;
  /** The stop phrase that actually ended parsing (null = ran to end of text). */
  stopReason: string | null;
  /** How many times a soft stop phrase (TOTAL ACCOUNT BALANCE) was seen. */
  stopPhraseSeen: number;
  /** How many soft stop phrases were ignored because more rows followed. */
  stopPhraseIgnored: number;
  /** Rows completed after at least one soft stop phrase was ignored. */
  rowsAfterIgnoredStop: number;
  /** Date of the last completed transaction (a date only; no other content). */
  lastTransactionDate: string | null;
  /** Index of the last completed transaction. */
  lastTransactionIndex: number | null;
};

export type ParseStatementResponse = {
  ok: boolean;
  source: "real-parser" | "mock-fallback";
  fileName: string;
  pageCount: number | null;
  statementKind: StatementKind;
  rows: TransactionRow[];
  openingBalance: string | null;
  closingBalance: string | null;
  warnings: string[];
  /** Safe aggregate parsing counters (dev diagnostics). No raw content. */
  creditCardStats?: CreditCardParseStats;
  // NOTE: a raw text preview is intentionally NOT part of the response. Raw
  // statement text is too easy to leak via screenshots, so it is never returned
  // or shown, even in development.
};

export type ParsedStatement = {
  statementKind: StatementKind;
  rows: TransactionRow[];
  openingBalance: number | null;
  closingBalance: number | null;
  warnings: string[];
  creditCardStats?: CreditCardParseStats;
};

export const SCANNED_PDF_WARNING =
  "This looks like a scanned or image-only PDF. OCR support is not enabled yet.";
export const NO_ROWS_WARNING =
  "We could not confidently identify any transaction rows in this PDF.";
export const MISSING_BALANCE_WARNING =
  "Opening or closing balance was not found, so the balance check may be limited.";

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const CREDIT_KEYWORDS = [
  "deposit", "credit", "payroll", "refund", "interest", "e-transfer received",
  "transfer in", "reversal", "rebate", "cashback",
];
const DEBIT_KEYWORDS = [
  "purchase", "payment", "withdrawal", "pos", "fee", "debit", "pre-auth",
  "bill", "atm", "transfer out", "cheque", "check",
];

// Local row factory so this module has no runtime dependencies (only a type
// import), which keeps the parsing logic pure and trivially testable.
let parserRowCounter = 0;
function newRow(): TransactionRow {
  parserRowCounter += 1;
  return {
    id: `parsed-${parserRowCounter}-${Math.random().toString(36).slice(2, 7)}`,
    date: "",
    description: "",
    debit: null,
    credit: null,
    balance: null,
    category: "",
    confidence: 1,
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export type MoneyMatch = { raw: string; value: number; index: number; end: number };

/**
 * Extract money-looking values from a line.
 * Accepts: $1,234.56  -$84.20  $2,000.00  (84.20)  84.20-  1,000  84.20
 *
 * Deliberately rejects things that are NOT money:
 *  - plain integers / years / points / reference & account numbers (no decimal,
 *    no thousands separator, no currency sign)
 *  - percentages (20.99%)
 *  - any number that is part of a longer digit run (phone/card/reference numbers)
 *
 * With { requireDollar: true } only values carrying a "$" are returned, which is
 * the safest mode for statement layouts full of IDs and reference numbers.
 */
export function extractMoneyValues(
  text: string,
  opts: { requireDollar?: boolean } = {},
): MoneyMatch[] {
  const requireDollar = opts.requireDollar ?? false;
  const results: MoneyMatch[] = [];
  // Trailing accounting minus (e.g. "84.20-") must hug the number — no space —
  // so it cannot swallow the leading minus of the next value ("214 -84.20").
  const re = /(\()?\s*(-)?\s*(\$)?\s*(\d{1,3}(?:,\d{3})+|\d+)(\.\d{2})?(-)?\s*(\))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    if (raw.trim() === "") {
      if (m.index === re.lastIndex) re.lastIndex += 1;
      continue;
    }
    const openParen = m[1];
    const leadingMinus = m[2];
    const dollar = m[3];
    const digits = m[4];
    const decimals = m[5];
    const trailingMinus = m[6];
    const closeParen = m[7];

    // Locate the numeric core to inspect the characters around it.
    const numStart = m.index + raw.indexOf(digits);
    const numEnd = numStart + digits.length + (decimals ? decimals.length : 0);
    const before = numStart > 0 ? text[numStart - 1] : "";
    const after = numEnd < text.length ? text[numEnd] : "";

    // Reject percentages and numbers that are part of a longer identifier run.
    if (after === "%") continue;
    if (before && /\d/.test(before)) continue;
    if (after && /\d/.test(after)) continue;

    const hasDecimals = Boolean(decimals);
    const hasThousands = digits.includes(",");
    const hasDollar = Boolean(dollar);
    const negative =
      Boolean(openParen && closeParen) || Boolean(leadingMinus) || Boolean(trailingMinus);

    // A "money signal" is a currency sign, a 2-decimal part, or a thousands
    // separator. Plain integers (years, points, IDs) never qualify.
    const isMoney = hasDollar || hasDecimals || hasThousands || negative;
    if (!isMoney) continue;
    if (requireDollar && !hasDollar) continue;

    const numeric = Number(digits.replace(/,/g, "") + (decimals ?? ""));
    if (Number.isNaN(numeric)) continue;
    results.push({
      raw: raw.trim(),
      value: negative ? -numeric : numeric,
      index: m.index,
      end: m.index + raw.length,
    });
  }
  return results;
}

/**
 * Normalize a recognized date token to YYYY-MM-DD when the year is known.
 * When only month/day are available (e.g. "May 2") the optional fallbackYear is
 * used; without it, returns MM-DD. Returns null when the token is not a date.
 */
export function normalizeDate(raw: string, fallbackYear?: number): string | null {
  const s = raw.trim();

  // ISO: YYYY-MM-DD or YYYY/MM/DD
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) {
    const [, y, mo, d] = m;
    return `${y}-${pad2(Number(mo))}-${pad2(Number(d))}`;
  }

  // Numeric with 4-digit year: MM/DD/YYYY or DD/MM/YYYY (ambiguous)
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = Number(m[3]);
    // Disambiguate where we can; default to MM/DD (North American statements).
    let mo = a;
    let d = b;
    if (a > 12 && b <= 12) {
      mo = b;
      d = a;
    }
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${pad2(mo)}-${pad2(d)}`;
  }

  // Numeric with 2-digit year: MM/DD/YY
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/);
  if (m) {
    const mo = Number(m[1]);
    const d = Number(m[2]);
    const y = 2000 + Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${pad2(mo)}-${pad2(d)}`;
  }

  // MMM DD  (e.g. "May 2", "Jan. 14")
  m = s.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2})$/);
  if (m) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    const d = Number(m[2]);
    if (!mo || d < 1 || d > 31) return null;
    return fallbackYear ? `${fallbackYear}-${pad2(mo)}-${pad2(d)}` : `${pad2(mo)}-${pad2(d)}`;
  }

  // DD MMM  (e.g. "2 May", "14 Jan")
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,})\.?$/);
  if (m) {
    const d = Number(m[1]);
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (!mo || d < 1 || d > 31) return null;
    return fallbackYear ? `${fallbackYear}-${pad2(mo)}-${pad2(d)}` : `${pad2(mo)}-${pad2(d)}`;
  }

  return null;
}

const DATE_PATTERNS: RegExp[] = [
  /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/,
  /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/,
  /\b[A-Za-z]{3,9}\.?\s+\d{1,2}\b/,
  /\b\d{1,2}\s+[A-Za-z]{3,9}\b/,
];

/** Find the first date-looking token in a line. */
export function findDate(
  line: string,
): { match: string; index: number; end: number } | null {
  for (const re of DATE_PATTERNS) {
    const m = line.match(re);
    if (m && m.index !== undefined) {
      // Confirm it normalizes, to avoid matching e.g. "May the" style noise.
      if (normalizeDate(m[0]) !== null) {
        return { match: m[0], index: m.index, end: m.index + m[0].length };
      }
    }
  }
  return null;
}

/**
 * Detect a standalone opening/closing balance line via conservative keyword
 * matching. Returns null when the line is not a balance line.
 */
export function detectBalanceLine(
  line: string,
): { kind: "opening" | "closing"; value: number } | null {
  const lower = line.toLowerCase();
  const opening = /\b(opening balance|beginning balance|previous balance)\b/.test(lower);
  const closing = /\b(closing balance|ending balance|new balance)\b/.test(lower);
  if (!opening && !closing) return null;
  const moneys = extractMoneyValues(line);
  if (moneys.length === 0) return null;
  // The balance amount is the last money value on the line.
  const value = moneys[moneys.length - 1].value;
  return { kind: opening ? "opening" : "closing", value };
}

function directionFromKeywords(text: string): "debit" | "credit" | null {
  const lower = text.toLowerCase();
  if (CREDIT_KEYWORDS.some((k) => lower.includes(k))) return "credit";
  if (DEBIT_KEYWORDS.some((k) => lower.includes(k))) return "debit";
  return null;
}

/**
 * Try to turn a single line into a transaction row. Returns null when the line
 * does not look like a transaction (no date, or no money value).
 */
export function parseTransactionLine(
  line: string,
  fallbackYear?: number,
): TransactionRow | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // A balance line is not a transaction.
  if (detectBalanceLine(trimmed)) return null;

  const date = findDate(trimmed);
  if (!date) return null;

  const moneys = extractMoneyValues(trimmed);
  if (moneys.length === 0) return null;

  // Description is the text between the date and the first money value.
  const firstMoney = moneys.find((mv) => mv.index >= date.end) ?? moneys[0];
  const descStart = date.end;
  const descEnd = firstMoney.index > descStart ? firstMoney.index : trimmed.length;
  const description = trimmed.slice(descStart, descEnd).replace(/\s+/g, " ").trim();

  const row = newRow();
  row.date = normalizeDate(date.match, fallbackYear) ?? date.match;
  row.description = description;
  row.confidence = 0.9;
  const notes: string[] = [];

  // If 2+ money values, treat the last as a running balance.
  let amountMoney = firstMoney;
  if (moneys.length >= 2) {
    const last = moneys[moneys.length - 1];
    row.balance = last.value;
    const beforeBalance = moneys.filter((mv) => mv !== last && mv.index >= date.end);
    amountMoney = beforeBalance.length > 0 ? beforeBalance[beforeBalance.length - 1] : firstMoney;
  }

  const magnitude = Math.abs(amountMoney.value);
  const signedNegative = amountMoney.value < 0;
  const keywordDirection = directionFromKeywords(trimmed);

  let direction: "debit" | "credit";
  if (signedNegative) {
    direction = "debit";
  } else if (keywordDirection) {
    direction = keywordDirection;
  } else {
    // Truly uncertain: default to debit but flag it.
    direction = "debit";
    row.confidence -= 0.3;
    notes.push("Could not determine debit or credit; assumed debit.");
  }

  if (direction === "debit") {
    row.debit = magnitude;
  } else {
    row.credit = magnitude;
  }

  if (!description) {
    row.confidence -= 0.2;
    notes.push("Description could not be read.");
  }
  if (!/\d{4}/.test(row.date)) {
    row.confidence -= 0.1;
    notes.push("Year was not found on this line.");
  }

  row.confidence = clamp(Number(row.confidence.toFixed(2)), 0.3, 0.95);
  if (notes.length > 0) row.warning = notes.join(" ");

  return row;
}

function detectFallbackYear(text: string): number | undefined {
  const m = text.match(/\b(20\d{2})\b/);
  return m ? Number(m[1]) : undefined;
}

/**
 * Detect the statement year from a statement-period line such as
 * "STATEMENT FROM APR 24 TO MAY 25, 2026", falling back to the first year found.
 */
export function detectStatementPeriodYear(text: string): number | undefined {
  const period = text.match(/statement\s+(?:from|period)[^\n]*?(20\d{2})/i);
  if (period) return Number(period[1]);
  return detectFallbackYear(text);
}

// Phrases that flip a POSITIVE amount to a credit. Deliberately specific: a
// lone "credit" in a merchant name (e.g. "OPENAI* CHATGPT CREDIT") must NOT
// count, so we only match strong payment/refund phrases.
const CC_PAYMENT_PHRASES = [
  "payment - thank you",
  "paiement - merci",
  "payment received",
  "online payment",
];
const CC_REFUND_PHRASES = [
  "refund",
  "reversal",
  "returned purchase",
  "credit adjustment",
  "merchant credit",
  "cashback",
  "rebate",
];

// Hard stops: once seen inside the transaction section, parsing ends.
const CC_HARD_STOP_RE =
  /(time to pay|interest rate chart|important information about your rbc royal bank credit card statement)/i;
// Soft stop: "TOTAL ACCOUNT BALANCE" also appears in the page-1 right-side
// summary box, which the extractor can interleave with the transaction table.
// It only ends parsing when no more transaction rows follow it.
const CC_SOFT_STOP_RE = /total account balance/i;

/**
 * Conservatively classify a statement. Credit-card statements have several very
 * specific labels that bank-account statements do not.
 */
export function detectStatementKind(text: string): StatementKind {
  const lower = text.toLowerCase();
  const ccStrong =
    /previous account balance|total account balance|minimum payment|payment due date/.test(
      lower,
    );
  const ccWeak = [/\bvisa\b/, /mastercard/, /credit card/, /new balance/].filter((re) =>
    re.test(lower),
  ).length;
  if (ccStrong || ccWeak >= 2) return "credit-card";

  const bank =
    /opening balance|closing balance|withdrawals|deposits|balance forward|beginning balance|ending balance/.test(
      lower,
    );
  if (bank) return "bank-account";
  return "unknown";
}

type MonthDay = { month: number; day: number };

/** Match a leading "APR 22" date at the start of a string; returns the rest. */
function matchLeadingDate(s: string): { date: MonthDay; rest: string } | null {
  const m = s.match(/^\s*([A-Za-z]{3,9})\.?\s+(\d{1,2})(?!\d)(.*)$/);
  if (!m) return null;
  const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
  const day = Number(m[2]);
  if (!month || day < 1 || day > 31) return null;
  return { date: { month, day }, rest: m[3] };
}

/**
 * Parse the leading transaction date and optional posting date from a line.
 * Supports "APR 22 APR 24 DESC" (two dates) and "APR 24 DESC" (one date).
 */
function parseLeadingTransactionDates(
  line: string,
): { trans: MonthDay; posting?: MonthDay; rest: string } | null {
  const first = matchLeadingDate(line);
  if (!first) return null;
  const second = matchLeadingDate(first.rest);
  if (second) {
    return { trans: first.date, posting: second.date, rest: second.rest.trim() };
  }
  return { trans: first.date, rest: first.rest.trim() };
}

/** Find the last inline "$25.25" / "-$150.00" amount inside a string. */
function findInlineDollarAmount(s: string): { value: number; index: number } | null {
  const re = /(-)?\(?\$\s?(\d{1,3}(?:,\d{3})*|\d+)(\.\d{2})?(\))?/g;
  let m: RegExpExecArray | null;
  let last: { value: number; index: number } | null = null;
  while ((m = re.exec(s)) !== null) {
    const negative = Boolean(m[1]) || Boolean(m[4]);
    const numeric = Number(m[2].replace(/,/g, "") + (m[3] ?? ""));
    if (Number.isNaN(numeric)) continue;
    last = { value: negative ? -numeric : numeric, index: m.index };
  }
  return last;
}

/** Remove long reference/authorization numbers from a description fragment. */
function stripReferenceNumbers(s: string): string {
  return s.replace(/\b\d{10,}\b/g, " ").replace(/\s+/g, " ").trim();
}

/** A line that is essentially a single money amount (e.g. "$25.25", "-$150.00"). */
function parseAmountLine(line: string): number | null {
  const t = line.trim();
  const m = t.match(/^\(?\s*(-)?\s*(\$)?\s*(\d{1,3}(?:,\d{3})*|\d+)(\.\d{2})?\s*(-)?\)?$/);
  if (!m) return null;
  const negative = Boolean(m[1]) || Boolean(m[5]) || /^\(.*\)$/.test(t);
  const hasDollar = Boolean(m[2]);
  const hasDecimals = Boolean(m[4]);
  if (!hasDollar && !hasDecimals) return null; // bare integer is not an amount
  const numeric = Number(m[3].replace(/,/g, "") + (m[4] ?? ""));
  if (Number.isNaN(numeric)) return null;
  return negative ? -numeric : numeric;
}

/** A long all-digit line is a reference/authorization number, never an amount. */
function isReferenceLine(line: string): boolean {
  const digitsOnly = line.replace(/\s/g, "");
  return /^\d{12,}$/.test(digitsOnly) && !line.includes("$");
}

/** Foreign-currency / exchange-rate detail line (kept as a note, not a row). */
function isForeignCurrencyLine(line: string): boolean {
  return (
    /foreign currenc|exchange rate/i.test(line) ||
    /^(usd|us\$|eur|gbp|aud|jpy|mxn)\b/i.test(line)
  );
}

/** A transaction-table header row (words may be split across lines). */
function isTransactionHeader(line: string): boolean {
  const l = line.toLowerCase();
  return (
    /activity description/.test(l) ||
    /amount\s*\(\s*\$\s*\)/.test(l) ||
    (/\btransaction\b/.test(l) && /\bposting\b/.test(l))
  );
}

function hardStopReason(line: string): string | null {
  const m = line.match(CC_HARD_STOP_RE);
  return m ? m[1].toUpperCase() : null;
}

/**
 * Is there another transaction-start line ahead before any HARD stop? Used to
 * decide whether a "TOTAL ACCOUNT BALANCE" line is a real end-of-transactions
 * marker or just the interleaved right-side summary box.
 */
function hasTransactionStartAhead(lines: string[], from: number): boolean {
  for (let k = from; k < lines.length; k += 1) {
    const l = lines[k];
    if (CC_HARD_STOP_RE.test(l)) return false;
    const d = parseLeadingTransactionDates(l);
    if (d && d.posting !== undefined) return true; // double-date row
    if (d && d.rest === "" && k + 1 < lines.length && matchLeadingDate(lines[k + 1])) {
      return true; // split-line row
    }
  }
  return false;
}

function isoFromMonthDay(md: MonthDay, year?: number): string {
  return year
    ? `${year}-${pad2(md.month)}-${pad2(md.day)}`
    : `${pad2(md.month)}-${pad2(md.day)}`;
}

function buildCreditCardRow(
  transDate: MonthDay,
  description: string,
  amount: number,
  year: number | undefined,
  fxNote: string | null,
): TransactionRow {
  const row = newRow();
  row.date = isoFromMonthDay(transDate, year);
  row.description = description.replace(/\s+/g, " ").trim();
  row.balance = null; // credit cards have no per-transaction running balance.

  const magnitude = Math.abs(amount);
  const lower = row.description.toLowerCase();
  // Negative amounts are always credits. A POSITIVE amount is only a credit when
  // a strong payment/refund phrase is present — never on a lone "credit" word in
  // a merchant name (e.g. "OPENAI* CHATGPT CREDIT" stays a debit).
  const isCredit =
    amount < 0 ||
    CC_PAYMENT_PHRASES.some((p) => lower.includes(p)) ||
    CC_REFUND_PHRASES.some((p) => lower.includes(p));
  if (isCredit) {
    row.credit = magnitude;
  } else {
    row.debit = magnitude;
  }

  let confidence = 0.92;
  const notes: string[] = [];
  if (fxNote) {
    notes.push(fxNote);
    confidence -= 0.05;
  }
  if (!row.description) {
    notes.push("Description could not be read.");
    confidence -= 0.2;
  }
  if (!year) {
    notes.push("Statement year was not found.");
    confidence -= 0.1;
  }
  row.confidence = clamp(Number(confidence.toFixed(2)), 0.3, 0.95);
  if (notes.length > 0) row.warning = notes.join(" ");
  return row;
}

/**
 * Robust RBC-style credit card transaction scanner. Tolerates several layouts
 * produced by PDF text reconstruction:
 *   - "APR 22 APR 24 DESCRIPTION"            (two dates, amount on a later line)
 *   - "APR 22 APR 24 DESCRIPTION $25.25"     (amount inline)
 *   - "APR 22 APR 24 DESC 7451... $25.25"    (reference + amount inline)
 *   - "APR 22" / "APR 24 DESCRIPTION"        (split-line dates)
 * The transaction date is the first date; the posting date is parsing context.
 */
export function parseCreditCardTransactions(
  lines: string[],
  year?: number,
): { rows: TransactionRow[]; stats: CreditCardParseStats } {
  const rows: TransactionRow[] = [];
  const stats: CreditCardParseStats = {
    transactionSectionDetected: false,
    sameLineDateRows: 0,
    splitLineDateRows: 0,
    amountLinesDetected: 0,
    referenceLinesIgnored: 0,
    blocksAttempted: 0,
    blocksCompleted: 0,
    stopReason: null,
    stopPhraseSeen: 0,
    stopPhraseIgnored: 0,
    rowsAfterIgnoredStop: 0,
    lastTransactionDate: null,
    lastTransactionIndex: null,
  };

  let inSection = false;
  let pending: MonthDay | null = null; // a lone leading transaction date
  let ignoredStopOccurred = false;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (inSection) {
      // Hard stops always end parsing.
      if (CC_HARD_STOP_RE.test(line)) {
        stats.stopReason = hardStopReason(line);
        break;
      }
      // "TOTAL ACCOUNT BALANCE" also appears in the page-1 right-side summary
      // box, interleaved with the transaction table. Only treat it as the end
      // when no further transaction rows follow it.
      if (CC_SOFT_STOP_RE.test(line)) {
        stats.stopPhraseSeen += 1;
        if (hasTransactionStartAhead(lines, i + 1)) {
          stats.stopPhraseIgnored += 1;
          ignoredStopOccurred = true;
          i += 1;
          continue;
        }
        stats.stopReason = "TOTAL ACCOUNT BALANCE";
        break;
      }
    }

    if (isTransactionHeader(line)) {
      inSection = true;
      stats.transactionSectionDetected = true;
      i += 1;
      continue;
    }

    const dates = parseLeadingTransactionDates(line);
    if (dates) {
      const isDouble = dates.posting !== undefined;

      // Lone transaction-date line (split pattern). Treat it as a transaction
      // date if we are already in the section, or if the very next line also
      // starts with a date (a lone date + a posting line is a strong signal).
      if (!isDouble && dates.rest === "") {
        const nextLine = i + 1 < lines.length ? lines[i + 1] : "";
        if (inSection || matchLeadingDate(nextLine)) pending = dates.trans;
        i += 1;
        continue;
      }

      // A single-date line with a description, outside the section and without a
      // pending lone date, is likely a summary date line, not a transaction.
      if (!isDouble && !inSection && pending === null) {
        i += 1;
        continue;
      }

      // Transaction start.
      inSection = true;
      stats.transactionSectionDetected = true;
      stats.blocksAttempted += 1;

      let transDate: MonthDay;
      let splitUsed = false;
      if (pending !== null) {
        transDate = pending;
        splitUsed = true;
        pending = null;
      } else {
        transDate = dates.trans;
      }
      if (splitUsed) stats.splitLineDateRows += 1;
      else stats.sameLineDateRows += 1;

      let remainder = dates.rest;
      const descParts: string[] = [];
      let amount: number | null = null;
      let fxNote: string | null = null;
      let reachedReference = false;

      // Amount inline on the start line?
      const inline = findInlineDollarAmount(remainder);
      if (inline) {
        amount = inline.value;
        stats.amountLinesDetected += 1;
        remainder = remainder.slice(0, inline.index);
      }
      if (/\b\d{10,}\b/.test(remainder)) stats.referenceLinesIgnored += 1;
      const cleanedStart = stripReferenceNumbers(remainder);
      if (cleanedStart) descParts.push(cleanedStart);

      let j = i + 1;
      if (amount === null) {
        for (; j < lines.length; j += 1) {
          const l = lines[j];
          if (CC_HARD_STOP_RE.test(l)) {
            stats.stopReason = hardStopReason(l);
            break;
          }
          // A soft stop mid-block is interleaved sidebar text — skip it.
          if (CC_SOFT_STOP_RE.test(l)) continue;
          const amt = parseAmountLine(l);
          if (amt !== null) {
            amount = amt;
            stats.amountLinesDetected += 1;
            j += 1;
            break;
          }
          if (isReferenceLine(l)) {
            reachedReference = true;
            stats.referenceLinesIgnored += 1;
            continue;
          }
          if (isForeignCurrencyLine(l)) {
            fxNote = "A foreign currency detail line was present.";
            continue;
          }
          if (parseLeadingTransactionDates(l)) break; // next transaction starts
          if (!reachedReference) {
            const c = stripReferenceNumbers(l);
            if (c) descParts.push(c);
          }
        }
      }

      if (amount !== null) {
        const row = buildCreditCardRow(transDate, descParts.join(" "), amount, year, fxNote);
        rows.push(row);
        stats.blocksCompleted += 1;
        stats.lastTransactionDate = row.date;
        stats.lastTransactionIndex = rows.length - 1;
        if (ignoredStopOccurred) stats.rowsAfterIgnoredStop += 1;
      }
      i = j;
      continue;
    }

    // Any other line breaks a dangling lone transaction-date marker.
    pending = null;
    i += 1;
  }

  return { rows, stats };
}

/** Find the amount on (or just after) a labelled balance line. */
function findLabeledAmount(lines: string[], labelRe: RegExp): number | null {
  for (let i = 0; i < lines.length; i += 1) {
    if (!labelRe.test(lines[i])) continue;
    // Prefer a dollar amount on the same line.
    const onLine = extractMoneyValues(lines[i], { requireDollar: true });
    if (onLine.length > 0) return onLine[onLine.length - 1].value;
    // Otherwise look at the next couple of lines for a standalone amount.
    for (let j = i + 1; j <= i + 2 && j < lines.length; j += 1) {
      const amt = parseAmountLine(lines[j]);
      if (amt !== null) return amt;
    }
  }
  return null;
}

/**
 * Credit-card opening/closing balance detection with conservative labels only.
 * Avoids minimum payment, available credit, credit limit, points, etc.
 */
export function detectCreditCardBalances(lines: string[]): {
  opening: number | null;
  closing: number | null;
} {
  const opening = findLabeledAmount(lines, /previous (account )?balance/i);
  const closing =
    findLabeledAmount(lines, /\bnew balance\b/i) ??
    findLabeledAmount(lines, /total account balance/i);
  return { opening, closing };
}

function parseBankAccountStatement(
  lines: string[],
  fallbackYear: number | undefined,
): { rows: TransactionRow[]; openingBalance: number | null; closingBalance: number | null } {
  let openingBalance: number | null = null;
  let closingBalance: number | null = null;
  const rows: TransactionRow[] = [];

  for (const line of lines) {
    const balance = detectBalanceLine(line);
    if (balance) {
      if (balance.kind === "opening" && openingBalance === null) {
        openingBalance = balance.value;
      } else if (balance.kind === "closing") {
        closingBalance = balance.value;
      }
      continue;
    }
    const row = parseTransactionLine(line, fallbackYear);
    if (row) rows.push(row);
  }

  return { rows, openingBalance, closingBalance };
}

/**
 * Parse a full statement's extracted text into rows + balances + warnings.
 * `text` is the page text joined with newlines. Routes to a credit-card or
 * bank-account parser based on the detected statement kind.
 */
export function parseStatementText(text: string): ParsedStatement {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const statementKind = detectStatementKind(text);
  const year = detectStatementPeriodYear(text);

  let rows: TransactionRow[];
  let openingBalance: number | null;
  let closingBalance: number | null;
  let creditCardStats: CreditCardParseStats | undefined;

  if (statementKind === "credit-card") {
    const cc = parseCreditCardTransactions(lines, year);
    rows = cc.rows;
    creditCardStats = cc.stats;
    const balances = detectCreditCardBalances(lines);
    openingBalance = balances.opening;
    closingBalance = balances.closing;
  } else {
    const parsed = parseBankAccountStatement(lines, year);
    rows = parsed.rows;
    openingBalance = parsed.openingBalance;
    closingBalance = parsed.closingBalance;
  }

  const warnings: string[] = [];
  if (rows.length === 0) warnings.push(NO_ROWS_WARNING);
  if (openingBalance === null || closingBalance === null) {
    warnings.push(MISSING_BALANCE_WARNING);
  }

  return { statementKind, rows, openingBalance, closingBalance, warnings, creditCardStats };
}
