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
import {
  parseCoordinateTables,
  probeCoordinateHeaders,
  type PdfTextItem,
  type CoordinateHeaderProbe,
} from "./coordinate-table.ts";
import { detectStatementProfile } from "./statement-profiles.ts";
import type { StatementValidation } from "./statement-model.ts";
import type { AiAssistOutcome } from "./ai-assist.ts";

export type StatementKind = "credit-card" | "bank-account" | "unknown";

/**
 * Reusable layout families. A "family" is a table shape shared across many
 * issuers, so adding a bank rarely needs new code — only the family strategy.
 */
export type LayoutFamily = "credit-card-table" | "bank-account-table" | "unknown";

/** Candidate parsing strategies that compete; the highest-scoring one wins. */
export type CandidateName =
  | "coordinate-table"
  | "credit-card-simple"
  | "credit-card-sectioned"
  | "bank-account"
  | "fallback";

/** Where the chosen rows came from. */
export type CandidateSource = "coordinate-table" | "text-parser" | "fallback";

/** Layout-level aggregate diagnostics (dev only). Counts/statuses only. */
export type LayoutParseStats = {
  layoutFamily: LayoutFamily;
  candidate: CandidateName;
  candidateScore: number;
  candidatesTried: number;
  creditCardTableDetected: boolean;
  bankAccountTableDetected: boolean;
  transactionSectionsDetected: number;
  rowsAttempted: number;
  rowsCompleted: number;
  amountColumnRows: number;
  debitColumnRows: number;
  creditColumnRows: number;
  balanceColumnRows: number;
  ignoredSummaryRows: number;
  ignoredSpendReportRows: number;
  candidateComparison: CandidateComparison[];
  // Account/section scoping + summary-isolation diagnostics (dev only).
  accountSectionsDetected: number;
  chosenAccountSection: string | null;
  ignoredAccountSections: number;
  transactionTableStartFound: boolean;
  summaryRowsUsedForValidation: number;
  summaryRowsIgnoredAsTransactions: number;
  balanceForwardRowsHandled: number;
  finalRunningBalanceUsedAsClosing: boolean;
  outOfPeriodRowsRejected: number;
  accountFeeSummaryRowsIgnored: number;
  subtotalRowsIgnored: number;
  // Boundary/summary-isolation diagnostics (dev only; counts/labels, no content).
  summaryStatisticalRowsRejected: number;
  legalInfoRowsIgnored: number;
  paymentRemittanceRowsIgnored: number;
  fxRowsAttached: number;
  feeCountRateRowsNormalized: number;
  accountSectionOpeningSource: string | null;
  selectedSectionHadOpeningClosing: boolean;
  // Coordinate-aware table extraction diagnostics (dev only; counts/labels).
  coordinateExtractionAvailable: boolean;
  tableCandidatesFound: number;
  chosenTableType: string | null;
  coordHeaderColumnsDetected: number;
  coordColumnOrder: string | null;
  coordRowsBuilt: number;
  coordDatelessRowsPromoted: number;
  coordWrappedDescriptionsJoined: number;
  coordFxDetailLinesAttached: number;
  coordSummaryRowsIgnored: number;
  coordFooterLegalRowsIgnored: number;
  /** True when the chosen candidate stitched multiple coordinate regions. */
  coordStitched: boolean;
  /** Number of coordinate regions combined into the chosen candidate. */
  coordRegionsStitched: number;
  /** Credit-card amount rows rejected as summary/metadata in the chosen candidate. */
  coordCcRowsRejectedAsNonTx: number;
  /** Zero-amount itemized CC lines ignored in the chosen candidate. */
  coordCcZeroAmountRowsIgnored: number;
  /** Optional CC columns (category/posting date) ignored in the chosen candidate. */
  coordCcOptionalColumnsIgnored: number;
  finalBalanceDifference: number | null;
  chosenCandidateSource: CandidateSource;
  /** Advisory statement profile name (generic fallback when unsure). */
  detectedProfile: string;
  /** Safe aggregate telemetry explaining coordinate header detection (no text). */
  coordHeaderProbe: CoordinateHeaderProbe;
  /** True when a statement period (with years) was detected for date inference. */
  statementPeriodDetected: boolean;
  /** Where the row year came from: statement period, a fallback year, or none. */
  inferredDateYearSource: "statement-period" | "fallback-year" | "none";
  /** Rows that still have no date after normalization (review signal). */
  rowsMissingDateAfterNormalization: number;
  /** Rows whose date is non-empty but not valid YYYY-MM-DD (should be 0). */
  malformedDatesAfterNormalization: number;
  /**
   * True when ANY detected transaction table/section in this statement structurally
   * contains a category / spend-category / merchant-category column (header), even
   * if that section was not the winning candidate. Gates ambiguous-category
   * stripping in the final cleanup. Safe boolean (no row text).
   */
  categoryColumnContextDetected: boolean;
  /** Rows whose trailing AMBIGUOUS category label was stripped (count only). */
  ambiguousCategoriesStripped: number;
  /** Rows carrying an internal statement-provided category after build (count only). */
  metadataCategoriesCaptured: number;
  /** Dateless rows that inherited the most recent valid date in the table (count). */
  rowsDateInherited: number;
  /** Rows still missing a date after carry-forward (review signal; count only). */
  rowsStillMissingDate: number;
  /** Transfer (e-Transfer/Interac/online) descriptions normalized (count only). */
  eTransferDescriptionsNormalized: number;
  /** Raw reference/hash fragments removed from transfer descriptions (count only). */
  rawReferenceFragmentsRemoved: number;
  /** Bank fee rows with a count/rate formula ("N Dr/Cr @ rate") detected (count). */
  formulaRateRowsDetected: number;
  /** Formula fee rows whose amount used the separate posted amount column (count). */
  formulaRateRowsResolvedToPostedAmount: number;
  /** Formula fee rows whose amount used the computed Σ(count×rate) total (count). */
  formulaRateRowsUsedComputedTotal: number;
  /** Trailing rows recovered without a running balance near a page bottom (count). */
  pageBottomRowsRecovered: number;
  /** Rows accepted although their running-balance column was blank (count). */
  rowsAcceptedWithoutRunningBalance: number;
};

/** Per-candidate aggregate comparison (dev diagnostics only; no row content). */
export type CandidateComparison = {
  name: CandidateName;
  score: number;
  rowCount: number;
  totalCredits: number;
  totalDebits: number;
  openingDetected: boolean;
  closingDetected: boolean;
  balanceStatus: "passed" | "needs-review" | "limited";
  balanceDiff: number | null;
};

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
  /** Count of section headings (Payments / Purchases / Interest …) detected. */
  sectionsDetected: number;
  /** Summary/label lines skipped (previous balance, minimum payment, etc.). */
  ignoredSummaryRows: number;
  /** Spend report / rewards / budget / message-centre lines skipped. */
  ignoredSpendReportRows: number;
  /** Rows rejected because the date fell outside the statement period. */
  periodRejected: number;
  /** Rows whose final CAD amount was captured past foreign-currency detail lines. */
  fxRowsAttached: number;
  /** Payment-slip / remittance label rows suppressed (never transactions). */
  paymentRemittanceRejected: number;
  /**
   * Bare date+amount (or amount-only) rows rejected because they sat next to a
   * payment-due / remittance / amount-due label on a NEIGHBORING line and carried
   * no merchant description — i.e. a payment obligation, not a posted transaction.
   */
  paymentDueContextRejected: number;
  /** Rows whose year was inferred from a cross-year statement period. */
  crossYearRowsInferred: number;
};

export type ParseStatementResponse = {
  ok: boolean;
  source: "real-parser" | "mock-fallback";
  fileName: string;
  pageCount: number | null;
  statementKind: StatementKind;
  layoutFamily: LayoutFamily;
  rows: TransactionRow[];
  openingBalance: string | null;
  closingBalance: string | null;
  warnings: string[];
  /** True when MEANINGFUL pages were skipped by the free-preview page cap. */
  previewLimited: boolean;
  /** Pages actually converted (<= pageCount when previewLimited). */
  pagesProcessed: number | null;
  /** Pages that contain transaction-like content (safe count, no text). */
  meaningfulPagesDetected?: number;
  /** Meaningful pages skipped by the page cap (safe count). */
  skippedMeaningfulPagesCount?: number;
  /** Safe label for the preview-limit decision. */
  previewLimitedReason?: "no-truncation" | "skipped-meaningful-pages" | "skipped-pages-not-meaningful";
  /** Safe deployment/runtime label (e.g. "production", "development"). No secrets. */
  runtimeEnv?: string;
  /** Safe aggregate parsing counters (dev diagnostics). No raw content. */
  creditCardStats?: CreditCardParseStats;
  parseStats?: LayoutParseStats;
  /** Canonical model validation (status / confidence / issues). No raw content. */
  validation?: StatementValidation;
  /** Explicit AI-assist outcome (status/config/diagnostics). No raw content. */
  aiAssist?: AiAssistOutcome;
  // NOTE: a raw text preview is intentionally NOT part of the response. Raw
  // statement text is too easy to leak via screenshots, so it is never returned
  // or shown, even in development.
};

/**
 * Low-level parser output (one pipeline stage). This is NOT the canonical
 * statement model the rest of the app consumes — see `ParsedStatement` in
 * `statement-model.ts`, which is built from this via `buildParsedStatement`.
 * Kept as a distinct type so the extraction/heuristics layer and the normalized
 * domain model can evolve independently.
 */
export type ParseResult = {
  statementKind: StatementKind;
  layoutFamily: LayoutFamily;
  rows: TransactionRow[];
  openingBalance: number | null;
  closingBalance: number | null;
  /** Printed statement totals detected for validation (never transactions). */
  summary: { credits: number | null; debits: number | null };
  warnings: string[];
  creditCardStats?: CreditCardParseStats;
  parseStats?: LayoutParseStats;
};

export const SCANNED_PDF_WARNING =
  "This looks like a scanned or image-based statement. StatementCSV currently supports digital PDF statements only.";
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

// Decorative / extraction-artifact symbols that sometimes lead a description
// (rewards markers, replacement chars, bullets, daggers, etc.). Only stripped
// when they appear as LEADING junk — meaningful merchant text is untouched.
const LEADING_JUNK_RE =
  /^[\sÝ�•·°†‡◦▪●○■□★☆∙*•·]+/;

/** Collapse whitespace and strip leading decorative/extraction symbols. */
export function cleanDescription(s: string): string {
  const collapsed = s.replace(/\s+/g, " ").trim();
  return collapsed.replace(LEADING_JUNK_RE, "").trim();
}

/**
 * Best-effort description recovery for a bank-table row whose description column
 * was not captured by the leading-text rule (e.g. the description sits AFTER the
 * amount/date columns). Strips the date token and money amounts from the whole
 * line and keeps the remaining alphabetic text. Generic — no bank-specific text.
 * Returns "" when nothing word-like remains (so the caller still flags the row).
 */
export function recoverDescriptionFromLine(line: string, dateMatch: string | null): string {
  let s = line;
  if (dateMatch) s = s.split(dateMatch).join(" ");
  // Remove money amounts (with/without $, thousands, parens, trailing minus).
  s = s
    .replace(/\(?-?\$?\s*\d{1,3}(?:,\d{3})+(?:\.\d{2})?\)?-?/g, " ")
    .replace(/\(?-?\$?\s*\d+\.\d{2}\)?-?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Require at least one real word so we don't promote a stray reference number.
  if (!/[A-Za-z]{2,}/.test(s)) return "";
  return cleanDescription(s);
}

// Statement-provided SPEND-CATEGORY taxonomy phrases (e.g. a credit card's "Spend
// Categories" column). DISTINCTIVE multi-word phrases only — every entry is an
// "X and Y" / multi-token taxonomy label that is extremely unlikely to be the real
// ending of a merchant name, so stripping it from a polluted Description is safe
// even WITHOUT structural confirmation. Generic across issuers, not a single bank.
const SPEND_CATEGORY_PHRASES = [
  "retail and grocery",
  "health and education",
  "professional and financial services",
  "professional and financial",
  "personal and household expenses",
  "personal and household",
  "hotel, entertainment and recreation",
  "hotel entertainment and recreation",
  "entertainment and recreation",
  "home and office improvement",
  "home and office",
  "foreign currency transactions",
  "gas and automotive",
  "recreation and entertainment",
];

// AMBIGUOUS single-word / short category labels: these CAN be a real merchant-name
// ending ("JOEY RESTAURANTS"), so they are stripped ONLY when the caller confirms a
// category column was structurally detected for the row's table/section
// (allowAmbiguous). Curated taxonomy names (not generic words) and never a
// city/province token. Generic across issuers.
const AMBIGUOUS_SPEND_CATEGORIES = [
  "restaurants",
  "transportation",
  "transport",
  "groceries",
  "merchandise",
  "healthcare",
];

const escapeRe = (p: string) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const buildTrailingRe = (phrases: string[]) =>
  new RegExp(`\\s+(${phrases.map(escapeRe).join("|")})\\s*$`, "i");

const TRAILING_DISTINCTIVE_RE = buildTrailingRe(SPEND_CATEGORY_PHRASES);
const TRAILING_WITH_AMBIGUOUS_RE = buildTrailingRe([
  ...SPEND_CATEGORY_PHRASES,
  ...AMBIGUOUS_SPEND_CATEGORIES,
]);
const AMBIGUOUS_SET = new Set(AMBIGUOUS_SPEND_CATEGORIES);

/**
 * Separate a statement-provided spend-category label that leaked onto the END of a
 * Description. Returns the cleaned description plus the category when a taxonomy
 * label is found trailing real merchant text; otherwise returns the description
 * unchanged with an empty category.
 *
 * By default only DISTINCTIVE multi-word phrases are stripped (safe without any
 * structural signal). When `allowAmbiguous` is set — i.e. the parser STRUCTURALLY
 * detected a category column for this row's table/section — shorter ambiguous
 * labels ("Restaurants", "Transportation") are also stripped, with an extra guard
 * that real merchant/location text (>= 2 tokens) must remain so a short merchant is
 * never clipped. City/province tokens are never category labels, so they are kept.
 */
export function splitTrailingSpendCategory(
  description: string,
  opts: { allowAmbiguous?: boolean } = {},
): { description: string; category: string } {
  const re = opts.allowAmbiguous ? TRAILING_WITH_AMBIGUOUS_RE : TRAILING_DISTINCTIVE_RE;
  const m = description.match(re);
  if (!m || m.index === undefined) return { description, category: "" };
  const head = description.slice(0, m.index).trim();
  // Require meaningful merchant text to remain; never reduce a row to (near) empty,
  // and never strip when the whole description IS just the category label.
  if (head.length < 3 || !/[A-Za-z]{2,}/.test(head)) return { description, category: "" };
  // Ambiguous labels need a stronger guard: a multi-token head (merchant + more,
  // e.g. with city/province), so a short merchant ending in the word isn't clipped.
  if (AMBIGUOUS_SET.has(m[1].toLowerCase()) && head.split(/\s+/).filter(Boolean).length < 2) {
    return { description, category: "" };
  }
  return { description: head, category: m[1].trim() };
}

/** True when a captured category label is one of the AMBIGUOUS single-word labels. */
export function isAmbiguousSpendCategory(label: string): boolean {
  return AMBIGUOUS_SET.has(label.trim().toLowerCase());
}

// A transaction-table header that names a category column. The distinctive
// multi-word phrases ("Spend Categories", "Merchant Category", …) are detected
// directly; a bare "Category"/"Categories" only counts when it co-occurs with other
// transaction-table headers on the same line (so prose containing the word "category"
// is never mistaken for a column). Structure-aware and statement-level.
const CATEGORY_COLUMN_HEADER_RE = /\b(?:spend|merchant|transaction|purchase)\s+categor(?:y|ies)\b/i;

/**
 * Did ANY header line in the statement declare a category column? Used as a
 * statement/section-level signal so ambiguous-category stripping can be enabled for
 * the final selected rows even when the winning candidate is the text-parser path
 * (whose column order does not carry the coordinate "category" marker). Safe: reads
 * header lines only and returns a boolean.
 */
export function detectCategoryColumnContext(lines: string[]): boolean {
  for (const l of lines) {
    if (CATEGORY_COLUMN_HEADER_RE.test(l)) return true;
    if (
      /\bcategor(?:y|ies)\b/i.test(l) &&
      /\bdescription\b/i.test(l) &&
      /\b(?:amount|debit|credit|balance|trans(?:action)?\.?\s*date|post(?:ing)?\.?\s*date|date)\b/i.test(l)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Carry the most recent valid transaction date forward onto dateless rows WITHIN a
 * single selected transaction-table context (the chosen candidate's row sequence).
 *
 * Many bank statements omit the printed date on same-day continuation rows. By the
 * time a candidate is selected, its rows are ALL transaction rows from one table
 * context (summary / legal / footer / page-furniture rows have already been
 * excluded, and section/stitch boundaries decided), so inheriting the previous
 * row's date is the same-day-continuation recovery — never a cross-section guess.
 *
 * Safety: only fills EMPTY dates, never overwrites; only inherits when a previous
 * row in the SAME sequence had a valid date (no previous date ⇒ left empty so the
 * row stays a review signal); operates only on the rows handed to it. Returns the
 * number of rows whose date was inherited.
 */
export function carryForwardRowDates(rows: TransactionRow[]): number {
  let last: string | null = null;
  let inherited = 0;
  for (const row of rows) {
    if (row.date && row.date.trim()) {
      last = row.date;
      continue;
    }
    if (last) {
      row.date = last;
      inherited += 1;
      // The row is no longer missing a date — drop a stale "date unknown" note so
      // it is not falsely flagged for review after a safe inheritance.
      if (row.warning) {
        const cleaned = row.warning
          .replace(/date could not be determined\.?/i, "")
          .replace(/\s{2,}/g, " ")
          .trim();
        row.warning = cleaned.length > 0 ? cleaned : undefined;
      }
    }
  }
  return inherited;
}

// Canadian transfer descriptions (Interac e-Transfer, online transfer/banking,
// autodeposit). Used to gate reference-noise cleanup so only transfer rows are
// touched. Generic across institutions — wording families, not bank names.
const TRANSFER_DESC_RE =
  /e-?transfer|interac|autodeposit|online (?:transfer|banking)(?: payment)?|transfer (?:sent|received|in|out)/i;

/**
 * A raw reference / confirmation / hash fragment that pollutes a transfer
 * description (e.g. "8a3f9c2d1e", "CA00123ABC45", a 12+ digit reference). Names,
 * initials, transfer-type words and city/province tokens never match (no token
 * with letters AND >= 2 digits, or a 12+ digit run).
 */
function isReferenceNoiseToken(token: string): boolean {
  const t = token.replace(/^[#:*-]+|[#:*-]+$/g, "");
  if (t.length < 8) return false;
  const hasLetter = /[A-Za-z]/.test(t);
  const digitCount = (t.match(/\d/g) ?? []).length;
  // Mixed-alphanumeric confirmation/hash code (letters + >= 2 digits, all alnum).
  if (hasLetter && digitCount >= 2 && /^[A-Za-z0-9]+$/.test(t)) return true;
  // Long pure-digit reference number.
  if (!hasLetter && digitCount >= 12) return true;
  return false;
}

/**
 * Normalize a Canadian transfer (Interac e-Transfer / online transfer / autodeposit)
 * description: keep the human-readable transfer type + recipient/sender name and
 * remove raw reference/hash fragments — but ONLY when readable text remains. Never
 * touches non-transfer descriptions, never removes names/words, and never reduces a
 * description to empty (if only a raw token exists, it is left as-is). Returns the
 * cleaned description and whether any reference fragment was removed.
 */
export function normalizeTransferDescription(description: string): {
  description: string;
  removed: boolean;
} {
  if (!description || !TRANSFER_DESC_RE.test(description)) {
    return { description, removed: false };
  }
  const tokens = description.split(/\s+/).filter(Boolean);
  const kept = tokens.filter((t) => !isReferenceNoiseToken(t));
  if (kept.length === tokens.length) return { description, removed: false };
  const cleaned = cleanDescription(kept.join(" "));
  // Require meaningful human-readable text (a word) to remain; otherwise keep the
  // original so we never blank out or over-strip a description.
  if (!/[A-Za-z]{2,}/.test(cleaned)) return { description, removed: false };
  return { description: cleaned, removed: true };
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

    // A "money signal" is a currency sign, a 2-decimal part, or a thousands
    // separator. A leading/trailing minus alone does NOT qualify, otherwise a
    // date separator (e.g. the "-05-" in "2024-05-02") would be read as -5.
    const isMoney = hasDollar || hasDecimals || hasThousands;
    if (!isMoney) continue;

    const negative =
      Boolean(openParen && closeParen) || Boolean(leadingMinus) || Boolean(trailingMinus);
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

/**
 * Parse a bare day/month date with NO year (e.g. "23/01", "5-1"), using the
 * statement's inferred year. Day/month order is disambiguated the same way as the
 * year-bearing parser (default month/day, swap when the first part is > 12), which
 * covers Canadian DD/MM credit-card statements (e.g. credit unions) whose
 * transaction tables print "DD/MM DD/MM Description Amount".
 *
 * Intentionally NOT added to findDate/DATE_PATTERNS: a bare "NN/NN" is too easily
 * confused with other tokens in free text, so this is used only where a value is
 * already known to be a date (a coordinate date-column cell). Returns null when the
 * token is not a plausible day/month date.
 */
export function parseDayMonthDate(raw: string, fallbackYear?: number): string | null {
  const m = raw.trim().match(/^(\d{1,2})[/-](\d{1,2})$/);
  if (!m) return null;
  let mo = Number(m[1]);
  let d = Number(m[2]);
  if (mo > 12 && d <= 12) {
    const t = mo;
    mo = d;
    d = t;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return fallbackYear ? `${fallbackYear}-${pad2(mo)}-${pad2(d)}` : `${pad2(mo)}-${pad2(d)}`;
}

/**
 * Full statement date context used to turn bare day/month transaction dates into
 * correct YYYY-MM-DD values. Carries the period's start/end (with real years) and
 * whether the statement writes dates day-first (DD/MM, common on Canadian
 * statements). All fields are inferred from the document, never assumed.
 */
export type StatementDateContext = {
  startYear: number;
  startMonth: number;
  endYear: number;
  endMonth: number;
  crossesYear: boolean;
  /** True when the statement uses day-first (DD/MM) numeric dates. */
  dayFirst: boolean;
};

/**
 * Detect the statement date context from a period line. Handles a NUMERIC range
 * like "30/12/2024 - 29/01/2025" (day-first inferred when a component > 12) and a
 * month-name range like "January 10 to February 9, 2026". Returns null when no
 * period with usable years is found, so callers can fall back safely.
 */
export function detectStatementDateContext(text: string): StatementDateContext | null {
  // Numeric DD/MM/YYYY (or MM/DD/YYYY) range.
  const num = text.match(
    /\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b\s*(?:to|through|-|–|—|−)\s*\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/i,
  );
  if (num) {
    const a1 = Number(num[1]);
    const b1 = Number(num[2]);
    const y1 = Number(num[3]);
    const a2 = Number(num[4]);
    const b2 = Number(num[5]);
    const y2 = Number(num[6]);
    // Day-first when any first component cannot be a month, month-first when any
    // second component cannot be a day's month slot. Default to day-first only when
    // a clear signal says so; otherwise month-first (North American numeric).
    const dayFirst = a1 > 12 || a2 > 12 ? true : b1 > 12 || b2 > 12 ? false : false;
    const startMonth = dayFirst ? b1 : a1;
    const endMonth = dayFirst ? b2 : a2;
    if (startMonth < 1 || startMonth > 12 || endMonth < 1 || endMonth > 12) return null;
    return { startYear: y1, startMonth, endYear: y2, endMonth, crossesYear: y1 !== y2 || startMonth > endMonth, dayFirst };
  }
  // Month-name range with a single trailing year (e.g. "... February 9, 2026").
  const named = text.match(
    /([A-Za-z]{3,9})\.?\s+\d{1,2}\s*(?:to|through|-|–|—|−)\s*([A-Za-z]{3,9})\.?\s+\d{1,2}(?:,)?\s*(20\d{2})/i,
  );
  if (named) {
    const sm = MONTHS[named[1].slice(0, 3).toLowerCase()];
    const em = MONTHS[named[2].slice(0, 3).toLowerCase()];
    const endYear = Number(named[3]);
    if (!sm || !em) return null;
    const crosses = sm > em;
    return {
      startYear: crosses ? endYear - 1 : endYear,
      startMonth: sm,
      endYear,
      endMonth: em,
      crossesYear: crosses,
      dayFirst: false,
    };
  }
  return null;
}

/**
 * Resolve a bare day/month token (e.g. "29/01") to YYYY-MM-DD using the statement
 * date context: day/month order from `dayFirst`/impossibility, and the YEAR chosen
 * so the month falls inside the statement period (handles a December→January
 * year boundary). Returns null when no valid date can be formed (so the caller can
 * flag the row for review rather than emit a malformed date).
 */
export function resolveDayMonthDate(
  raw: string,
  ctx: StatementDateContext | null,
  dayFirst: boolean,
  fallbackYear?: number,
): string | null {
  const m = raw.trim().match(/^(\d{1,2})[/-](\d{1,2})$/);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  let day = dayFirst ? a : b;
  let month = dayFirst ? b : a;
  // Fix an impossible assignment (the other order is forced).
  if (month < 1 || month > 12) {
    const t = day;
    day = month;
    month = t;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  let year: number | undefined = fallbackYear;
  if (ctx) {
    if (ctx.crossesYear) {
      // A month at/after the start month belongs to the start year; otherwise the
      // end year (e.g. Dec → start year 2024, Jan → end year 2025).
      year = month >= ctx.startMonth ? ctx.startYear : ctx.endYear;
    } else {
      year = ctx.startYear;
    }
  }
  return year ? `${year}-${pad2(month)}-${pad2(day)}` : `${pad2(month)}-${pad2(day)}`;
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
  // Collect every normalizing match across all patterns, then return the
  // earliest by position. Scanning ALL matches (not just each pattern's first)
  // matters when a non-date token precedes a real date on the line, e.g.
  // "Deposit 16,336.25 JAN 2 27,094.52" — the leading "Deposit 16" / decimal
  // "25 JAN" must be skipped in favour of the genuine "JAN 2".
  const found: { match: string; index: number; end: number }[] = [];
  for (const base of DATE_PATTERNS) {
    const re = new RegExp(base.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const raw = m[0];
      const idx = m.index;
      if (raw === "") {
        re.lastIndex += 1;
        continue;
      }
      // Reject a match whose leading digit is really part of a larger number
      // (e.g. the "25" of "16,336.25" forming a false "25 JAN" day-month token).
      const before = idx > 0 ? line[idx - 1] : "";
      if (/^\d/.test(raw) && /[.,\d]/.test(before)) continue;
      if (normalizeDate(raw) !== null) {
        found.push({ match: raw, index: idx, end: idx + raw.length });
      }
    }
  }
  if (found.length === 0) return null;
  found.sort((a, b) => a.index - b.index);
  return found[0];
}

/**
 * Detect a standalone opening/closing balance line via conservative keyword
 * matching. Returns null when the line is not a balance line.
 */
export function detectBalanceLine(
  line: string,
): { kind: "opening" | "closing"; value: number } | null {
  const lower = line.toLowerCase();
  const opening = /\b(opening balance|beginning balance|previous balance|balance forward)\b/.test(lower);
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
  row.description = cleanDescription(description);
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

export type StatementPeriod = {
  startOrd: number;
  endOrd: number;
  crossesYear: boolean;
  startMonth: number;
  endMonth: number;
  /** Year printed beside the start/end of the period, when present (else null). */
  startYear: number | null;
  endYear: number | null;
};

/** A coarse, year-agnostic day ordinal so dates can be range-compared cheaply. */
function dateOrdinal(month: number, day: number): number {
  return (month - 1) * 31 + day;
}

/**
 * Detect a statement period like "January 10 to February 9, 2026",
 * "FROM APR 24 TO MAY 25", or a cross-year period that prints a year beside each
 * endpoint: "December 10, 2025 to January 9, 2026". The optional ", YYYY" after
 * each day is captured so cross-year row years can be inferred per month. Used to
 * reject dates well outside the period (e.g. a payment-due date on a remittance
 * slip) and to assign the correct year to each transaction.
 */
export function detectStatementPeriod(text: string): StatementPeriod | null {
  const m = text.match(
    /([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?\s*(?:to|through|-|–|—)\s*([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?/i,
  );
  if (!m) return null;
  const m1 = MONTHS[m[1].slice(0, 3).toLowerCase()];
  const m2 = MONTHS[m[4].slice(0, 3).toLowerCase()];
  const d1 = Number(m[2]);
  const d2 = Number(m[5]);
  if (!m1 || !m2 || d1 < 1 || d1 > 31 || d2 < 1 || d2 > 31) return null;
  const startOrd = dateOrdinal(m1, d1);
  const endOrd = dateOrdinal(m2, d2);
  const startYear = m[3] ? Number(m[3]) : null;
  const endYear = m[6] ? Number(m[6]) : null;
  return {
    startOrd,
    endOrd,
    crossesYear: startOrd > endOrd,
    startMonth: m1,
    endMonth: m2,
    startYear,
    endYear,
  };
}

/**
 * Infer the correct calendar year for a transaction month, honoring a statement
 * period that crosses a year boundary. For "December 10, 2025 to January 9, 2026"
 * a December row resolves to 2025 and a January row to 2026 — never the single
 * statement year for every row. Falls back to `fallback` when the period carries
 * no year context. General across issuers; not statement-specific.
 */
export function inferRowYear(
  period: StatementPeriod | null,
  month: number,
  fallback: number | undefined,
): number | undefined {
  if (!period) return fallback;
  if (!period.crossesYear) {
    return period.startYear ?? period.endYear ?? fallback;
  }
  // Crossing a year boundary: the start side (e.g. Dec) belongs to the earlier
  // year, the end side (e.g. Jan) to the later year. Use whichever year is known
  // and derive the other when only one is printed.
  const onStartSide = month >= period.startMonth;
  const onEndSide = month <= period.endMonth;
  if (onStartSide) {
    if (period.startYear !== null) return period.startYear;
    if (period.endYear !== null) return period.endYear - 1;
  }
  if (onEndSide) {
    if (period.endYear !== null) return period.endYear;
    if (period.startYear !== null) return period.startYear + 1;
  }
  return period.endYear ?? period.startYear ?? fallback;
}

/** Is a month/day within the statement period (with a posting-lag buffer)? */
function dateInPeriod(
  period: StatementPeriod,
  month: number,
  day: number,
  buffer = 10,
): boolean {
  const ord = dateOrdinal(month, day);
  if (period.crossesYear) {
    return ord >= period.startOrd - buffer || ord <= period.endOrd + buffer;
  }
  return ord >= period.startOrd - buffer && ord <= period.endOrd + buffer;
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

const CC_FAMILY_SIGNALS: RegExp[] = [
  /previous (account )?balance/,
  /minimum payment/,
  /payment due date/,
  /new balance/,
  /total account balance/,
  /trans(?:\.|action)? date/,
  /post(?:ing)? date/,
  /\bvisa\b/,
  /mastercard/,
  /credit card/,
  /cash advances?/,
  /interest charged|interest charge/,
];

const BANK_FAMILY_SIGNALS: RegExp[] = [
  /opening balance/,
  /closing balance/,
  /account activity/,
  /balance forward/,
  /beginning balance/,
  /ending balance/,
];

/**
 * Classify the statement into a reusable LAYOUT FAMILY. This is intentionally
 * shape-based (not issuer-based) so one strategy serves many banks. When signals
 * are weak it returns "unknown" so the UI can show Needs Review rather than
 * pretending.
 */
export function detectLayoutFamily(text: string): LayoutFamily {
  const lower = text.toLowerCase();
  const ccScore = CC_FAMILY_SIGNALS.filter((re) => re.test(lower)).length;
  const bankScore = BANK_FAMILY_SIGNALS.filter((re) => re.test(lower)).length;
  // A withdrawals + deposits pairing is the defining bank-account-table shape.
  const hasWithdrawDeposit = /withdrawals?/.test(lower) && /deposits?/.test(lower);

  if (hasWithdrawDeposit) return "bank-account-table";
  if (bankScore >= 2 && bankScore >= ccScore) return "bank-account-table";
  if (ccScore >= 2) return "credit-card-table";
  if (bankScore >= 1) return "bank-account-table";
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
    /foreign currenc|exchange rate|currency conversion|conversion rate/i.test(line) ||
    /^(usd|us\$|eur|gbp|aud|jpy|mxn|cad)\b/i.test(line) ||
    // Mid-line currency code or an "@ rate" detail (e.g. "175.00 USD @ 1.357").
    /\b(usd|eur|gbp|aud|jpy|mxn)\b/i.test(line) && /@|exchange|rate/i.test(line)
  );
}

/** A transaction-table header row (words may be split across lines). */
function isTransactionHeader(line: string): boolean {
  const l = line.toLowerCase();
  return (
    /activity description/.test(l) ||
    /amount\s*\(\s*\$\s*\)/.test(l) ||
    (/\btransaction\b/.test(l) && /\bposting\b/.test(l)) ||
    (/trans(?:\.|action)? date/.test(l) && /post(?:ing)? date/.test(l))
  );
}

// Spend report / rewards / certificate / budget / message centre lines are never
// transactions. Generalized across issuers to also cover spend-category summaries,
// rewards/cashback certificates, and gift certificates (e.g. a CreditSmart spend
// report or a Costco cashback gift-certificate page) — money values on these pages
// are summaries/awards, not posted itemized transactions.
const CC_SPEND_REPORT_RE =
  /spend(?:ing)? report|spend categor(?:y|ies)|rewards? (?:summary|earned|certificate|program)|gift certificate|cash[\s-]?back (?:certificate|reward|summary)|reward certificate|creditsmart|budget|message cent(?:re|er)|points? (?:summary|balance|earned)/i;

// Remittance / payment-due CONTEXT labels. These mark the payment slip / amount-due
// box area. A bare "date + amount" or "amount only" line near one of these is a
// payment obligation (minimum payment, amount due, total payment enclosed), NOT a
// posted transaction — even though the label sits on a NEIGHBORING line, so a
// single-line check cannot catch it. Used as a windowed context guard. General
// across issuers; not statement-specific.
const CC_REMITTANCE_CONTEXT_RE =
  /minimum payment|amount due|amount past due|payment due|payment due date|please pay (?:this amount )?by|please pay by|total payment enclosed|payment (?:slip|coupon|options)|remittance|tear[\s-]?off|mail (?:your )?payment|amount enclosed/i;

// Summary/label lines (skipped, not transactions). Used only for diagnostics.
const CC_SUMMARY_LABEL_RE =
  /previous (?:account )?balance|minimum payment|payment due date|credit limit|available credit|new balance|total (?:account )?balance/i;

/**
 * Section heading inside a credit-card statement. Returns the default direction
 * for rows under that heading: "credit" for payments/credits, "debit" otherwise.
 * Only matches short heading-style lines, never transaction lines.
 */
function creditCardSection(line: string): "credit" | "debit" | null {
  const l = line.trim().toLowerCase();
  // Charges/purchases/interest/fees are debit sections; check these first so a
  // heading like "your new charges and credits" is not read as a credit section.
  if (/(new charges|charges and credits|purchases|cash advances?)/.test(l)) return "debit";
  if (/^(your )?interest\b/.test(l)) return "debit";
  if (/^(fees|service charges?)\b/.test(l)) return "debit";
  if (/^(your )?payments?\b/.test(l) && !/due|minimum/.test(l)) return "credit";
  if (/^(your )?credits?\b/.test(l)) return "credit";
  if (/payments?\s*(?:&|and)\s*credits/.test(l)) return "credit";
  return null;
}

// Payment-slip / remittance / summary label lines that are never transactions,
// even when they carry a date and an amount (e.g. a CIBC payment slip).
const CC_IGNORE_LINE_RE =
  /minimum payment|amount due|amount past due|payment due|payment slip|payment options|total payment enclosed|please pay|remittance|subtotal of monthly activity|total (?:debits|credits)|other (?:debits|credits)|cash advances|fees charged|interest charged|total fees for this period|total interest for this period|credit limit|available credit|\bloc limit\b/i;

// Payment-slip / remittance label lines (a subset of the ignore list). Tracked
// separately for diagnostics so we can show how many remittance rows were
// suppressed without ever exposing their content.
const CC_PAYMENT_REMITTANCE_RE =
  /minimum payment|amount due|amount past due|payment due|payment slip|payment options|total payment enclosed|please pay|remittance/i;

/**
 * Capture the transaction amount from a credit-card row remainder. Prefers a
 * "$"-prefixed value (RBC), then falls back to the rightmost decimal money value
 * (CIBC-style far-right Amount column with no "$"). Detects a trailing "CR".
 */
function captureCreditCardAmount(
  remainder: string,
): { value: number; index: number; explicitCredit: boolean } | null {
  const dollar = findInlineDollarAmount(remainder);
  if (dollar) {
    return { value: dollar.value, index: dollar.index, explicitCredit: dollar.value < 0 };
  }
  const moneys = extractMoneyValues(remainder);
  if (moneys.length === 0) return null;
  const last = moneys[moneys.length - 1];
  const trailing = remainder.slice(last.end);
  const explicitCredit = last.value < 0 || /\bcr\b/i.test(trailing);
  return { value: last.value, index: last.index, explicitCredit };
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
  ctx: { sectionCredit?: boolean; explicitCredit?: boolean } = {},
): TransactionRow {
  const row = newRow();
  row.date = isoFromMonthDay(transDate, year);
  row.description = cleanDescription(description);
  row.balance = null; // credit cards have no per-transaction running balance.

  const magnitude = Math.abs(amount);
  const lower = row.description.toLowerCase();
  // Credit when: amount is negative or flagged (e.g. "CR"); the row is under a
  // payments/credits section; or the description has a strong payment/refund
  // phrase. A lone "credit" word in a merchant name does NOT flip a positive
  // charge (e.g. "OPENAI* CHATGPT CREDIT" stays a debit).
  const isCredit =
    amount < 0 ||
    Boolean(ctx.explicitCredit) ||
    Boolean(ctx.sectionCredit) ||
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
  opts: { useSections?: boolean; period?: StatementPeriod | null } = {},
): { rows: TransactionRow[]; stats: CreditCardParseStats } {
  const useSections = opts.useSections ?? false;
  const period = opts.period ?? null;
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
    sectionsDetected: 0,
    ignoredSummaryRows: 0,
    ignoredSpendReportRows: 0,
    periodRejected: 0,
    fxRowsAttached: 0,
    paymentRemittanceRejected: 0,
    paymentDueContextRejected: 0,
    crossYearRowsInferred: 0,
  };

  // Precompute which line indexes carry remittance / payment-due CONTEXT so a bare
  // date+amount line whose label sits a line or two away can be rejected. Reading
  // the surrounding structure (not the single line) is what makes this general.
  const remittanceContextIdx = lines.map((l) => CC_REMITTANCE_CONTEXT_RE.test(l));
  const REMITTANCE_WINDOW = 3;
  const nearRemittanceContext = (idx: number): boolean => {
    const lo = Math.max(0, idx - REMITTANCE_WINDOW);
    const hi = Math.min(lines.length - 1, idx + REMITTANCE_WINDOW);
    for (let k = lo; k <= hi; k += 1) {
      if (remittanceContextIdx[k]) return true;
    }
    return false;
  };

  let inSection = false;
  let pending: MonthDay | null = null; // a lone leading transaction date
  let ignoredStopOccurred = false;
  // Default section is a charge section (debit); a "Payments"/"Credits" heading
  // flips it to credit for the rows that follow.
  let currentSectionCredit = false;
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

    const isDateLine = parseLeadingTransactionDates(line) !== null;
    const hasMoney = extractMoneyValues(line).length > 0;

    // Section headings (Payments / Purchases / Interest …) set the default
    // direction for the rows beneath them. They are short, dateless, moneyless.
    if (!isDateLine && !hasMoney) {
      const section = creditCardSection(line);
      if (section) {
        currentSectionCredit = section === "credit";
        stats.sectionsDetected += 1;
        inSection = true;
        stats.transactionSectionDetected = true;
        i += 1;
        continue;
      }
      if (CC_SPEND_REPORT_RE.test(line)) {
        stats.ignoredSpendReportRows += 1;
        i += 1;
        continue;
      }
      if (CC_SUMMARY_LABEL_RE.test(line)) {
        stats.ignoredSummaryRows += 1;
        i += 1;
        continue;
      }
    } else if (!isDateLine && CC_SUMMARY_LABEL_RE.test(line)) {
      // A summary label line with a money value (e.g. "Minimum payment $10.00").
      stats.ignoredSummaryRows += 1;
      i += 1;
      continue;
    } else if (!isDateLine && CC_SPEND_REPORT_RE.test(line)) {
      // A spend-report / rewards / cashback-or-gift-certificate line that carries a
      // money value but no transaction date (e.g. a spend-category total or a
      // certificate award). It is a summary/award, never a posted transaction.
      stats.ignoredSpendReportRows += 1;
      i += 1;
      continue;
    }

    // Payment slip / remittance / period-total lines are never transactions,
    // even with a date (e.g. a remittance "New Balance"/"Amount Past Due" slip,
    // or "TOTAL INTEREST FOR THIS PERIOD"). A real interest transaction row keeps
    // a transaction date and merchant text, so it is unaffected.
    if (CC_IGNORE_LINE_RE.test(line)) {
      stats.ignoredSummaryRows += 1;
      if (CC_PAYMENT_REMITTANCE_RE.test(line)) stats.paymentRemittanceRejected += 1;
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

      // Transaction start. Remember the start line so a remittance/payment-due
      // context check can look at the neighboring lines around this row.
      const blockStartIdx = i;
      inSection = true;
      stats.transactionSectionDetected = true;

      let transDate: MonthDay;
      let splitUsed = false;
      if (pending !== null) {
        transDate = pending;
        splitUsed = true;
        pending = null;
      } else {
        transDate = dates.trans;
      }

      // Period gating: a date well outside the statement period (e.g. a payment
      // due date on a remittance slip) is not a transaction.
      if (period && !dateInPeriod(period, transDate.month, transDate.day)) {
        stats.ignoredSummaryRows += 1;
        stats.periodRejected += 1;
        i += 1;
        continue;
      }

      stats.blocksAttempted += 1;
      if (splitUsed) stats.splitLineDateRows += 1;
      else stats.sameLineDateRows += 1;

      let remainder = dates.rest;
      const descParts: string[] = [];
      let amount: number | null = null;
      let explicitCredit = false;
      let fxNote: string | null = null;
      let reachedReference = false;

      // Amount inline on the start line? Prefers "$" (RBC), then the rightmost
      // decimal value (CIBC far-right Amount column with no "$").
      const inline = captureCreditCardAmount(remainder);
      if (inline) {
        amount = inline.value;
        explicitCredit = inline.explicitCredit;
        stats.amountLinesDetected += 1;
        remainder = remainder.slice(0, inline.index);
      }
      if (/\b\d{10,}\b/.test(remainder)) stats.referenceLinesIgnored += 1;
      const cleanedStart = stripReferenceNumbers(remainder);
      if (cleanedStart) descParts.push(cleanedStart);

      let j = i + 1;
      let fxSeen = false;
      let lastFxAmount: number | null = null;
      if (amount === null) {
        for (; j < lines.length; j += 1) {
          const l = lines[j];
          if (CC_HARD_STOP_RE.test(l)) {
            stats.stopReason = hardStopReason(l);
            break;
          }
          // A soft stop mid-block is interleaved sidebar text — skip it.
          if (CC_SOFT_STOP_RE.test(l)) continue;
          // A subtotal/summary line ends this transaction block (it bounds how
          // far we will look for the amount, so FX collection cannot run on).
          if (CC_IGNORE_LINE_RE.test(l)) break;
          if (parseLeadingTransactionDates(l)) break; // next transaction starts
          if (isForeignCurrencyLine(l)) {
            fxSeen = true;
            fxNote = "A foreign currency detail line was present.";
            continue;
          }
          const amt = parseAmountLine(l);
          if (amt !== null) {
            if (fxSeen) {
              // After foreign-currency detail, the foreign amount may appear on
              // its own line BEFORE the final CAD amount. Keep the LAST standalone
              // amount in the block so the settled CAD value wins.
              lastFxAmount = amt;
              continue;
            }
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
          if (!reachedReference) {
            const c = stripReferenceNumbers(l);
            if (c) descParts.push(c);
          }
        }
        if (amount === null && lastFxAmount !== null) {
          amount = lastFxAmount;
          stats.amountLinesDetected += 1;
          stats.fxRowsAttached += 1;
        }
      }

      if (amount !== null) {
        const description = descParts.join(" ");
        // GENERAL remittance/payment-due rejection: a "date + amount" (or
        // amount-only) row with NO merchant description that sits next to a
        // payment-due / amount-due / minimum-payment / remittance label is a
        // payment obligation, not a posted transaction. Real transactions carry
        // merchant text, so requiring an empty description keeps this safe. The
        // label commonly sits on a neighboring line (own-line amount on a slip),
        // which a single-line check cannot catch — hence the windowed context.
        const hasMerchantText = /[A-Za-z]{3,}/.test(cleanDescription(description));
        if (!hasMerchantText && nearRemittanceContext(blockStartIdx)) {
          stats.paymentDueContextRejected += 1;
          stats.paymentRemittanceRejected += 1;
          i = j;
          continue;
        }
        // Cross-year aware year: a December row inside a Dec→Jan period is the
        // earlier year; a January row the later year. Falls back to `year`.
        const rowYear = inferRowYear(period, transDate.month, year);
        if (rowYear !== year) stats.crossYearRowsInferred += 1;
        const row = buildCreditCardRow(transDate, description, amount, rowYear, fxNote, {
          // Section direction only applies in the sectioned strategy.
          sectionCredit: useSections && currentSectionCredit,
          explicitCredit,
        });
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

/** A statement line is a year-to-date / prior-year total (never a current-period item). */
const YEAR_TO_DATE_RE = /year[\s-]?to[\s-]?date|\bytd\b|\bin 20\d\d\b|20\d\d totals|totals? year/i;

/** Find a labelled amount, skipping year-to-date / prior-year total lines. */
function findCurrentPeriodLabeledAmount(lines: string[], labelRe: RegExp): number | null {
  const currentOnly = lines.filter((l) => !YEAR_TO_DATE_RE.test(l));
  return findLabeledAmount(currentOnly, labelRe);
}

export type CreditCardInterestFeeLine = {
  description: string;
  amount: number;
  date: string | null;
};

/**
 * Detect credit-card CURRENT-PERIOD interest and fee activity. Total Debits on a
 * credit-card statement includes purchases + cash advances + fees charged +
 * interest charged, but the interest/fee lines often sit in their own FEES /
 * INTEREST section that a transaction-row parser (or a vision pass) can miss,
 * leaving debits short by exactly that amount. This returns the current-period
 * totals plus the individual NONZERO interest/fee line items so the shortfall can
 * be repaired from real evidence. Year-to-date / prior-year totals are excluded,
 * and zero lines (e.g. "Interest Charge on Cash Advances $0.00") are ignored.
 */
export function detectCreditCardInterestFees(
  lines: string[],
  fallbackYear?: number,
): {
  interestCharged: number | null;
  feesCharged: number | null;
  lineItems: CreditCardInterestFeeLine[];
} {
  // Current-period totals: prefer the explicit "for this period" label, then the
  // summary-box "Interest Charged" / "Fees Charged" (still excluding YTD lines).
  const interestCharged =
    findCurrentPeriodLabeledAmount(lines, /total interest for this period/i) ??
    findCurrentPeriodLabeledAmount(lines, /\binterest charged\b/i);
  const feesCharged =
    findCurrentPeriodLabeledAmount(lines, /total fees for this period/i) ??
    findCurrentPeriodLabeledAmount(lines, /\bfees? charged\b/i);

  const lineItems: CreditCardInterestFeeLine[] = [];
  const ITEM_RE =
    /interest charge(?:d)? on |finance charge|service charge|annual fee|over[\s-]?limit fee|cash advance fee|late (?:payment )?fee|\bfee\b/i;
  for (const raw of lines) {
    if (YEAR_TO_DATE_RE.test(raw)) continue;
    // Totals/section headers are not individual line items.
    if (/total (?:fees|interest) (?:for this period|charged)/i.test(raw)) continue;
    if (!ITEM_RE.test(raw)) continue;
    // Rate disclosure lines carry a percentage, not a posted amount.
    if (/%/.test(raw)) continue;
    const money = extractMoneyValues(raw);
    if (money.length === 0) continue;
    const amount = Math.abs(money[money.length - 1].value);
    if (amount < 0.01) continue; // ignore zero lines (e.g. cash advances 0.00)
    const d = findDate(raw);
    const date = d ? normalizeDate(d.match, fallbackYear) : null;
    // Description: strip leading date tokens and any money amounts.
    const description = raw
      .replace(/\$?\(?-?\d{1,3}(?:,\d{3})*(?:\.\d{2})?\)?-?/g, " ")
      .replace(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!description) continue;
    lineItems.push({ description, amount, date });
  }
  return { interestCharged, feesCharged, lineItems };
}

/**
 * Find the amount on (or just after) a labelled balance line. An optional
 * `excludeRe` skips lines that also match a confusable label (e.g. when looking
 * for "payments / total credits", skip "minimum payment" / "payment due" lines).
 */
function findLabeledAmount(lines: string[], labelRe: RegExp, excludeRe?: RegExp): number | null {
  for (let i = 0; i < lines.length; i += 1) {
    if (!labelRe.test(lines[i])) continue;
    if (excludeRe && excludeRe.test(lines[i])) continue;
    // Prefer a dollar amount on the labelled line, then any money value on it
    // (many statements print balances without a "$", e.g. "Previous Balance 1,605.47").
    const onLineDollar = extractMoneyValues(lines[i], { requireDollar: true });
    if (onLineDollar.length > 0) return onLineDollar[onLineDollar.length - 1].value;
    const onLineAny = extractMoneyValues(lines[i]);
    if (onLineAny.length > 0) return onLineAny[onLineAny.length - 1].value;
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
  // OPENING (prior-period balance) label family. Order: most specific first.
  const opening =
    findLabeledAmount(lines, /previous (?:account |statement )?balance/i) ??
    findLabeledAmount(lines, /prior (?:account |statement )?balance/i) ??
    findLabeledAmount(lines, /balance from (?:your )?previous statement/i) ??
    findLabeledAmount(lines, /opening balance/i);
  // CLOSING (this-period balance) label family. "new balance" / "total balance"
  // are the strongest; "statement balance" / "total amount due" are common
  // alternatives. Exclude minimum/past-due/previous so we never grab those.
  const CLOSING_EXCLUDE = /minimum|past due|previous|prior|available/i;
  const closing =
    findLabeledAmount(lines, /\bnew balance\b/i, CLOSING_EXCLUDE) ??
    findLabeledAmount(lines, /total account balance/i, CLOSING_EXCLUDE) ??
    findLabeledAmount(lines, /total balance/i, CLOSING_EXCLUDE) ??
    findLabeledAmount(lines, /statement balance/i, CLOSING_EXCLUDE) ??
    findLabeledAmount(lines, /total amount due/i, CLOSING_EXCLUDE) ??
    findLabeledAmount(lines, /\bbalance due\b/i, CLOSING_EXCLUDE);
  return { opening, closing };
}

/**
 * Light credit-card summary detection (optional, for validation/scoring only).
 * Returns labelled section totals where present; nulls otherwise.
 */
export function detectCreditCardSummary(lines: string[]): {
  credits: number | null;
  debits: number | null;
} {
  // CREDITS family = payments + credits to the card. Skip "minimum payment" /
  // "payment due" / remittance lines so a payment-slip figure is never used.
  const PAYMENT_EXCLUDE =
    /minimum|payment due|past due|please pay|payment enclosed|payment options|how to|available/i;
  // DEBITS family = purchases + charges. Exclusions are light (these labels are
  // rarely confusable) but avoid per-category interest/fee sublabels here.
  const payments = findLabeledAmount(
    lines,
    /your payments|payments? (?:&|and|\/) ?credits/i,
    PAYMENT_EXCLUDE,
  );
  const purchases = findLabeledAmount(
    lines,
    /your new charges|new charges (?:&|and|\/) ?credits|purchases (?:&|and|\/) ?debits/i,
  );
  const interest = findLabeledAmount(lines, /your interest|interest charged/i);
  // Generic statement-summary labels used by many issuers (a summary box with
  // "Total Credits"/"Total Payments" and "Total Debits"/"Total Charges"/"Total
  // Purchases"). An explicit authoritative "Total X" is preferred over summing
  // component lines (which can be partial). Label families, not bank-specific.
  const totalCreditsLabel =
    findLabeledAmount(lines, /total payments? ?(?:&|and|\/) ?credits/i, PAYMENT_EXCLUDE) ??
    findLabeledAmount(lines, /total credits/i, PAYMENT_EXCLUDE) ??
    findLabeledAmount(lines, /total payments?\b/i, PAYMENT_EXCLUDE);
  const totalDebitsLabel =
    findLabeledAmount(lines, /total purchases? ?(?:&|and|\/) ?debits?/i) ??
    findLabeledAmount(lines, /total (?:debits?|charges?|purchases?)\b/i);
  const credits = totalCreditsLabel ?? payments;
  const componentDebits =
    purchases !== null || interest !== null
      ? (purchases ?? 0) + (interest ?? 0)
      : null;
  const debits = totalDebitsLabel ?? componentDebits;
  return { credits, debits };
}

/**
 * Light bank-account summary detection (validation/scoring only). Reads labelled
 * total deposits/credits and total withdrawals/debits where present.
 */
export function detectBankSummary(lines: string[]): {
  credits: number | null;
  debits: number | null;
} {
  const credits =
    findLabeledAmount(lines, /total amounts? credited/i) ??
    findLabeledAmount(lines, /total deposits/i);
  const debits =
    findLabeledAmount(lines, /total amounts? debited/i) ??
    findLabeledAmount(lines, /total withdrawals/i);
  return { credits, debits };
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
 * Generic bank-account table strategy for the shape:
 *   Date | Description | Withdrawals | Deposits | Balance
 *
 * Withdrawals map to Debit and Deposits to Credit. Because a reconstructed line
 * usually shows only [amount, balance] (the blank column collapses), direction
 * is decided by the running-balance delta, which is layout-independent. Dates
 * carry forward and wrapped descriptions are joined.
 */
// Start of the real transaction table on a bank-account statement.
const BANK_START_RE =
  /details of your account activity|account activity|transaction details|details of account/i;
// End of the transaction table (legal/footer/closing sections). Once any of
// these is seen inside the activity table, later text (legal/info/marketing) is
// NOT scanned for transactions — this stops false amounts from informational
// sections after the activity (e.g. a "$100,000.00" in a disclosure paragraph).
const BANK_STOP_RE =
  /important information about your account|important account information|how to (?:reach|contact) us|trade ?-?marks?|^member\b|closing notice|closing totals/i;

// Page-summary / statistical rows that are NEVER transactions even though they
// carry a money value (end-of-account totals, per-page item statistics, average
// balances, etc.). Reusable across banks; only applied to DATELESS lines so a
// real dated transaction such as "Jan 31 Interest Paid 5.00" is never dropped.
const BANK_SUMMARY_ROW_RE =
  /^(?:total|sub-?total|interest\b|service charge|deposits?\b|withdrawals?\b|credits?\b|debits?\b|cheques?\b|chqs?\b|number of|no\.? of items|monthly (?:aver|min|average|minimum)|average (?:cr|dr|daily)?\.? ?bal|minimum (?:cr|dr)?\.? ?bal|cash content|next statement|statement date|items? (?:processed|enclosed|deposited)|transaction totals?)\b/i;
// A dateless line that matches a summary keyword can STILL be an itemized
// transaction when a serial/reference number follows the keyword (e.g. "Cheque -
// 122", "Chq #4051", "Item No. 7783", "Draft 0091"). Statistical summaries use the
// plural/total/count forms ("Cheques 7 26,111.25", "Total cheques") and never carry
// a "- ###" / "#" / "No." reference. Generic across issuers, not bank-specific —
// this keeps real cheque/draft/item rows that omit their own date or balance.
const BANK_ITEMIZED_REF_RE =
  /\b(?:cheque|chq|ch[eè]que|draft|voucher|item|ref(?:erence)?|serial)\b\s*(?:[-#:]\s*|no\.?\s*|number\s*)\d{2,}/i;
// Lines that are never transactions: headers, addresses, phone, control numbers,
// and "From <date> to <date>, <year>" statement-period lines.
const BANK_IGNORE_LINE_RE =
  /statement period|account number|card number|page \d+ of \d+|p\.?o\.? box|customer service|www\.|royal bank of canada|how to reach|\b1[-\s]?8\d{2}[-\s]?\d{3}[-\s]?\d{4}\b|\bfrom\b[^\n]{0,40}\bto\b[^\n]{0,30}20\d{2}|closing totals|total amounts? (?:debited|credited)|number of items processed|^account fees?\b|\bloc limit\b|minimum payment|payment due date/i;

type BankEntry = {
  date: string;
  description: string;
  amount: number; // positive magnitude; sign decided by the solver
  balance: number | null; // running balance when displayed on this line
  prior: "credit" | "debit" | null;
};

// Bank fee rows often show a count/rate calculation instead of (or alongside) a
// total, e.g. "Regular transaction fee 2 Drs @ 1.25" or "1 Dr @ 0.75 / 1 Cr @
// 0.75". The bare rate (1.25) must NOT be read as the transaction amount; the
// real amount is the sum of count × rate across the "@" clauses (2 × 1.25 =
// 2.50). When an explicit total is also displayed it equals this sum, so using
// the computed total is always safe and reconciles with the running balance.
const FEE_COUNT_RATE_RE = /(\d+)\s*(?:drs?|crs?)\b\s*@\s*\$?\s*(\d+(?:\.\d{1,2})?)/gi;

/** Sum of count × rate across "N Dr/Cr @ rate" clauses, or null if none. */
export function feeCountRateTotal(line: string): number | null {
  if (!/@/.test(line)) return null;
  FEE_COUNT_RATE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  let total = 0;
  let found = false;
  while ((m = FEE_COUNT_RATE_RE.exec(line)) !== null) {
    found = true;
    total += Number(m[1]) * Number(m[2]);
  }
  return found ? Math.round(total * 100) / 100 : null;
}

/** True when the text contains a fee count/rate formula (a "N Dr/Cr @ rate" clause). */
export function hasFeeFormula(text: string): boolean {
  return feeCountRateTotal(text) !== null;
}

/** The RATE values (the "@ rate" amounts) in a fee count/rate formula. */
export function feeFormulaRates(text: string): number[] {
  FEE_COUNT_RATE_RE.lastIndex = 0;
  const rates: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = FEE_COUNT_RATE_RE.exec(text)) !== null) rates.push(Number(m[2]));
  return rates;
}

/**
 * A money value that is a RATE inside a COUNT/RATE fee formula (immediately preceded
 * by "@" AND the line actually contains a "N Dr/Cr @ rate" formula), e.g. the 0.75
 * in "1 Dr @ 0.75". Such values are NOT the posted amount. A bare "1 @ 5.00" (a
 * count with no Dr/Cr) is NOT a rate — there the 5.00 IS the posted amount — so we
 * require a real Dr/Cr formula on the line before excluding an "@"-preceded value.
 */
function isRateMoney(line: string, m: MoneyMatch): boolean {
  if (!hasFeeFormula(line)) return false;
  return /@\s*\$?\s*$/.test(line.slice(Math.max(0, m.index - 4), m.index));
}

/**
 * Strip a count/rate fee formula ("1 Dr @ 0.75 / 1 Cr @ 0.75") from a fee row's
 * description so the default Description reads as the fee label (e.g. "Electronic
 * transaction fee"). Conservative: only the formula fragments are removed.
 */
export function stripFeeFormula(desc: string): string {
  const cleaned = desc
    .replace(/\b\d+\s*(?:drs?|crs?)\b\s*@\s*\$?\s*\d+(?:\.\d{1,2})?/gi, " ")
    .replace(/@\s*\$?\s*\d+(?:\.\d{1,2})?/g, " ")
    .replace(/\b\d+\s*(?:drs?|crs?)\b/gi, " ")
    // Remove any leftover standalone "@" and separator slashes from the formula.
    .replace(/\s*@\s*/g, " ")
    .replace(/\s*\/\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned;
}

/** Bank-specific direction prior from the description wording. */
function bankKeywordPrior(desc: string): "credit" | "debit" | null {
  const l = desc.toLowerCase();
  if (/received|deposit|payroll|\bei\b|\bcredit\b|refund|interest paid|rebate|gov|gst|transfer in/.test(l)) {
    return "credit";
  }
  if (/sent|payment|purchase|loan|\bfee\b|withdrawal|\batm\b|\bdebit\b|bill|cheque|service charge|transfer out|pre-?auth/.test(l)) {
    return "debit";
  }
  return null;
}

/**
 * Assign credit/debit signs to a segment's amounts so that
 *   startBalance + credits - debits = endBalance.
 * Returns per-amount directions, or null if no assignment reconciles.
 * Among reconciling assignments, the one best matching keyword priors wins.
 */
function solveSegment(
  amountsCents: number[],
  deltaCents: number,
  priors: ("credit" | "debit" | null)[],
): ("credit" | "debit")[] | null {
  const n = amountsCents.length;
  if (n === 0) return deltaCents === 0 ? [] : null;

  const total = amountsCents.reduce((a, b) => a + b, 0);
  // credits sum S satisfies 2S - total = delta.
  if ((deltaCents + total) % 2 !== 0) return null;
  const target = (deltaCents + total) / 2;
  if (target < 0 || target > total) return null;

  const priorScore = (creditMask: number): number => {
    let s = 0;
    for (let i = 0; i < n; i += 1) {
      const chosen = creditMask & (1 << i) ? "credit" : "debit";
      if (priors[i] === chosen) s += 1;
      else if (priors[i] && priors[i] !== chosen) s -= 1;
    }
    return s;
  };

  if (n <= 16) {
    let best: number | null = null;
    let bestScore = -Infinity;
    for (let mask = 0; mask < 1 << n; mask += 1) {
      let sum = 0;
      for (let i = 0; i < n; i += 1) if (mask & (1 << i)) sum += amountsCents[i];
      if (sum !== target) continue;
      const score = priorScore(mask);
      if (score > bestScore) {
        bestScore = score;
        best = mask;
      }
    }
    if (best === null) return null;
    return amountsCents.map((_, i) => ((best as number) & (1 << i) ? "credit" : "debit"));
  }

  // Too many amounts to brute force: trust priors and verify they reconcile.
  const signs = priors.map((p) => (p === "credit" ? "credit" : "debit") as "credit" | "debit");
  const creditSum = signs.reduce((a, s, i) => a + (s === "credit" ? amountsCents[i] : 0), 0);
  return creditSum === target ? signs : null;
}

/**
 * Bank-account table parser with a balance-segment solver. It collects entries
 * (including amount-only rows), then uses displayed running balances (and the
 * opening/closing balances) as anchors. Between two anchors it assigns
 * debit/credit signs so the segment reconciles, guided by keyword priors. This
 * works even when several transactions appear before the next running balance.
 */
export function parseBankAccountTable(
  lines: string[],
  year: number | undefined,
  openingBalance: number | null,
  closingBalance: number | null,
): {
  rows: TransactionRow[];
  attempted: number;
  ignoredSummaryRows: number;
  reconciled: boolean;
  lastBalance: number | null;
  outOfPeriodRejected: number;
  balanceForwardHandled: number;
  summaryStatisticalRejected: number;
  legalInfoIgnored: number;
  feeCountRateNormalized: number;
  formulaRateRowsDetected: number;
  formulaRateRowsResolvedToPostedAmount: number;
  formulaRateRowsUsedComputedTotal: number;
  pageBottomRowsRecovered: number;
} {
  const entries: BankEntry[] = [];
  let ignoredSummaryRows = 0;
  let outOfPeriodRejected = 0;
  let balanceForwardHandled = 0;
  let summaryStatisticalRejected = 0;
  let legalInfoIgnored = 0;
  let feeCountRateNormalized = 0;
  let formulaRateRowsDetected = 0;
  let formulaRateRowsResolvedToPostedAmount = 0;
  let formulaRateRowsUsedComputedTotal = 0;
  let pageBottomRowsRecovered = 0;
  // Seed with the opening balance so a fee row that is the FIRST row can still tell
  // its single non-rate value apart (running balance vs posted amount).
  let lastBalance: number | null = openingBalance;
  let carriedDate: string | null = null;
  let pendingDesc = "";

  const hasStart = lines.some((l) => BANK_START_RE.test(l));
  let inActivity = !hasStart;

  // ----- Phase 1: collect entries inside the activity table -----
  for (const line of lines) {
    if (BANK_STOP_RE.test(line)) {
      // Everything after a legal/footer/closing-totals marker is informational
      // and must never be parsed as transactions (e.g. a large dollar figure in
      // a disclosure paragraph). Stop scanning the activity table here.
      if (inActivity) {
        legalInfoIgnored += 1;
        break;
      }
      continue;
    }
    if (!inActivity) {
      if (BANK_START_RE.test(line)) inActivity = true;
      continue;
    }
    if (BANK_IGNORE_LINE_RE.test(line)) {
      ignoredSummaryRows += 1;
      pendingDesc = "";
      continue;
    }
    if (detectBalanceLine(line)) {
      // Opening/closing/balance-forward summary lines are anchors, not rows.
      if (/\bbalance forward\b/i.test(line)) balanceForwardHandled += 1;
      ignoredSummaryRows += 1;
      continue;
    }

    const date = findDate(line);
    const moneys = extractMoneyValues(line);

    // Dateless page-summary / statistical rows (end-of-account totals, per-page
    // item counts, average/min balances) are never transactions, even when they
    // carry a money value. Gated on "no date" so dated transactions survive.
    // EXCEPTION: a dateless service/fee row inside the active table carries an
    // amount AND a running balance that CONTINUES the sequence (balance ≈ prior
    // balance ± amount). Section totals also carry two figures but their balance
    // does NOT continue the running balance, so they remain summaries. This keeps
    // real end-of-statement fee charges without absorbing totals — generically.
    if (!date && BANK_SUMMARY_ROW_RE.test(line) && !BANK_ITEMIZED_REF_RE.test(line)) {
      let runningFeeRow = false;
      if (moneys.length >= 2 && lastBalance !== null) {
        const amt = Math.abs(moneys[moneys.length - 2].value);
        const bal = moneys[moneys.length - 1].value;
        runningFeeRow =
          Math.abs(bal - (lastBalance - amt)) < 0.01 || Math.abs(bal - (lastBalance + amt)) < 0.01;
      }
      if (!runningFeeRow) {
        summaryStatisticalRejected += 1;
        pendingDesc = "";
        continue;
      }
    }

    // Capture the date carried from prior rows BEFORE this line may set a new one,
    // so a deferred fee formula flushes against the correct (previous) date.
    const prevCarriedDate = carriedDate;
    if (date) carriedDate = normalizeDate(date.match, year) ?? date.match;

    // Fee-formula RATE values ("the 0.75 in 1 Dr @ 0.75") are NEVER the posted
    // transaction amount or a running balance — exclude them from selection.
    const postedMoneys = moneys.filter((m) => !isRateMoney(line, m));
    const feeTotal = feeCountRateTotal(`${pendingDesc} ${line}`);
    const dateLeadsLine =
      date !== null && (moneys.length === 0 || date.index < moneys[0].index);

    // A NEW dated transaction starts while a fee formula sits unflushed in
    // pendingDesc (its posted amount never appeared) — flush it as a computed-total
    // fee row first so it is neither lost nor merged into this row's description.
    if (postedMoneys.length >= 1 && date && dateLeadsLine && hasFeeFormula(pendingDesc)) {
      const ft = feeCountRateTotal(pendingDesc);
      if (ft !== null && ft > 0) {
        entries.push({
          date: prevCarriedDate ?? "",
          description: stripFeeFormula(pendingDesc) || "Service fee",
          amount: ft,
          balance: null,
          prior: "debit",
        });
        formulaRateRowsDetected += 1;
        formulaRateRowsUsedComputedTotal += 1;
        feeCountRateNormalized += 1;
      }
      pendingDesc = "";
    }

    if (postedMoneys.length === 0 && moneys.length >= 1) {
      // The only money on this line are fee-formula RATES (no posted amount/balance
      // yet) — fold into the pending description (a wrapped continuation) so it does
      // not emit a spurious rate-valued row. The posted amount, a new dated row, or
      // the trailing flush resolves the real fee total later.
      const frag = dateLeadsLine && date ? line.slice(date.end) : line;
      pendingDesc = `${pendingDesc} ${frag}`.replace(/\s+/g, " ").trim();
      continue;
    }

    if (postedMoneys.length >= 1) {
      // Description is the leading text up to the first money value; when a date
      // LEADS the row, skip it (otherwise it is a mid/late date column — TD-style
      // "Description Debit Credit DATE Balance" — and the leading text is desc).
      const dateLeads = date !== null && date.index < moneys[0].index;
      const descStart = dateLeads ? date!.end : 0;
      const descEnd = moneys[0].index;
      const inlineDesc = line
        .slice(descStart, Math.max(descStart, descEnd))
        .replace(/\s+/g, " ")
        .trim();
      let description = `${pendingDesc} ${inlineDesc}`.replace(/\s+/g, " ").trim();
      // Recovery: if the leading-text rule found no description (e.g. the label
      // sits after the amount columns), recover it from the rest of the line
      // before we fall back to a placeholder + warning.
      if (!description) {
        description = recoverDescriptionFromLine(line, date ? date.match : null);
      }

      // Decide the posted amount vs the running balance among the non-rate values.
      let amount: number;
      let balance: number | null;
      if (feeTotal !== null) {
        // Fee count/rate row. The computed total (Σ count×rate) is the posted fee
        // UNLESS a genuine separate posted amount exists that is not the running
        // balance. Prefer the actual posted amount column over the rate values.
        formulaRateRowsDetected += 1;
        feeCountRateNormalized += 1;
        if (postedMoneys.length >= 2) {
          amount = Math.abs(postedMoneys[postedMoneys.length - 2].value);
          balance = postedMoneys[postedMoneys.length - 1].value;
          formulaRateRowsResolvedToPostedAmount += 1;
        } else {
          // A single non-rate value is either the posted amount OR the running
          // balance. It is the BALANCE when it continues the running balance by the
          // computed fee total; otherwise it is the posted amount.
          const v = postedMoneys[0].value;
          const continuesBalance =
            lastBalance !== null &&
            (Math.abs(v - (lastBalance - feeTotal)) < 0.01 ||
              Math.abs(v - (lastBalance + feeTotal)) < 0.01);
          if (continuesBalance) {
            amount = feeTotal;
            balance = v;
            formulaRateRowsUsedComputedTotal += 1;
          } else {
            amount = Math.abs(v);
            balance = null;
            formulaRateRowsResolvedToPostedAmount += 1;
          }
        }
        description = stripFeeFormula(description) || description;
      } else {
        const hasBalance = postedMoneys.length >= 2;
        const amountMoney = hasBalance ? postedMoneys[postedMoneys.length - 2] : postedMoneys[0];
        balance = hasBalance ? postedMoneys[postedMoneys.length - 1].value : null;
        amount = Math.abs(amountMoney.value);
      }

      pendingDesc = "";
      if (!carriedDate && !description) {
        // Not enough context to be a transaction.
        ignoredSummaryRows += 1;
        continue;
      }
      // Reject impossible out-of-period years (e.g. a 2099 LOC expiry line).
      const yr = /^(\d{4})-/.exec(carriedDate ?? "");
      if (yr && Number(yr[1]) >= 2090) {
        outOfPeriodRejected += 1;
        continue;
      }
      if (balance !== null) lastBalance = balance;
      entries.push({
        date: carriedDate ?? "",
        description,
        amount,
        balance,
        prior: bankKeywordPrior(description),
      });
    } else if (date) {
      // Date line with no money: the start of a wrapped row.
      const buf = line.slice(date.end).replace(/\s+/g, " ").trim();
      pendingDesc = `${pendingDesc} ${buf}`.replace(/\s+/g, " ").trim();
    } else if (pendingDesc) {
      // Wrapped description continuation.
      pendingDesc = `${pendingDesc} ${line}`.replace(/\s+/g, " ").trim();
    } else {
      ignoredSummaryRows += 1;
    }
  }

  // A fee formula left unflushed in pendingDesc (no posted amount/balance and no
  // following row) is a real end-of-table fee charge — flush its computed total.
  if (hasFeeFormula(pendingDesc)) {
    const ft = feeCountRateTotal(pendingDesc);
    if (ft !== null && ft > 0) {
      entries.push({
        date: carriedDate ?? "",
        description: stripFeeFormula(pendingDesc) || "Service fee",
        amount: ft,
        balance: null,
        prior: "debit",
      });
      formulaRateRowsDetected += 1;
      formulaRateRowsUsedComputedTotal += 1;
      feeCountRateNormalized += 1;
      pendingDesc = "";
    }
  }

  // ----- Phase 2: solve segments between balance anchors -----
  const rows: TransactionRow[] = [];
  let reconciled = true;
  let anchor: number | null = openingBalance;
  let segment: BankEntry[] = [];

  const flushSegment = (endBalance: number | null) => {
    if (segment.length === 0) return;
    let signs: ("credit" | "debit")[] | null = null;
    if (anchor !== null && endBalance !== null) {
      const deltaCents = toCents(endBalance) - toCents(anchor);
      signs = solveSegment(
        segment.map((e) => toCents(e.amount)),
        deltaCents,
        segment.map((e) => e.prior),
      );
    }
    if (!signs) {
      // No reconciling assignment: fall back to keyword priors (best effort).
      reconciled = false;
      signs = segment.map((e) => (e.prior === "credit" ? "credit" : "debit"));
    }
    segment.forEach((e, idx) => {
      const row = newRow();
      row.date = e.date;
      row.description = cleanDescription(e.description);
      row.balance = e.balance;
      if (signs![idx] === "credit") row.credit = e.amount;
      else row.debit = e.amount;
      let confidence = 0.9;
      const notes: string[] = [];
      if (!e.date) {
        confidence -= 0.1;
        notes.push("Date could not be determined.");
      }
      if (!e.description) {
        confidence -= 0.2;
        notes.push("Description could not be read.");
      }
      row.confidence = clamp(Number(confidence.toFixed(2)), 0.3, 0.95);
      if (notes.length > 0) row.warning = notes.join(" ");
      rows.push(row);
    });
    segment = [];
  };

  for (const entry of entries) {
    segment.push(entry);
    if (entry.balance !== null) {
      flushSegment(entry.balance);
      anchor = entry.balance;
    }
  }
  // Trailing entries with no displayed balance (e.g. a page-bottom cheque/fee row
  // printed without a running balance) reconcile against the closing balance.
  pageBottomRowsRecovered = segment.filter((e) => e.balance === null).length;
  flushSegment(closingBalance);

  return {
    rows,
    attempted: entries.length,
    ignoredSummaryRows,
    reconciled,
    lastBalance,
    outOfPeriodRejected,
    balanceForwardHandled,
    summaryStatisticalRejected,
    legalInfoIgnored,
    feeCountRateNormalized,
    formulaRateRowsDetected,
    formulaRateRowsResolvedToPostedAmount,
    formulaRateRowsUsedComputedTotal,
    pageBottomRowsRecovered,
  };
}

// ----- Candidate-based parsing & scoring -----

const LOW_CONFIDENCE = 0.7; // mirror of upload LOW_CONFIDENCE_THRESHOLD (kept local)

type CandidateBalance = { available: boolean; passed: boolean; diffCents: number | null };

type Candidate = {
  name: CandidateName;
  statementKind: StatementKind;
  layoutFamily: LayoutFamily;
  rows: TransactionRow[];
  openingBalance: number | null;
  closingBalance: number | null;
  summary: { credits: number | null; debits: number | null };
  creditCardStats?: CreditCardParseStats;
  bankAttempted: number;
  bankIgnored: number;
  sectionsDetected: number;
  ignoredSpendReportRows: number;
  balance: CandidateBalance;
  score: number;
  // Scoping/summary diagnostics (defaults for non-bank candidates).
  accountSectionsDetected: number;
  chosenAccountSection: string | null;
  ignoredAccountSections: number;
  balanceForwardHandled: number;
  finalRunningBalanceUsedAsClosing: boolean;
  outOfPeriodRejected: number;
  summaryStatisticalRejected: number;
  legalInfoIgnored: number;
  paymentRemittanceRejected: number;
  fxRowsAttached: number;
  feeCountRateNormalized: number;
  formulaRateRowsDetected: number;
  formulaRateRowsResolvedToPostedAmount: number;
  formulaRateRowsUsedComputedTotal: number;
  pageBottomRowsRecovered: number;
  accountSectionOpeningSource: string | null;
  selectedSectionHadOpeningClosing: boolean;
  source: CandidateSource;
  coord: CoordDiag | null;
};

/** Coordinate-table aggregate diagnostics carried on a candidate. */
type CoordDiag = {
  tableCandidatesFound: number;
  chosenTableType: string | null;
  headerColumnsDetected: number;
  columnOrder: string | null;
  rowsBuilt: number;
  datelessRowsPromoted: number;
  wrappedDescriptionsJoined: number;
  fxDetailLinesAttached: number;
  summaryRowsIgnored: number;
  footerLegalRowsIgnored: number;
  stitched: boolean;
  regionsStitched: number;
  ccRowsRejectedAsNonTx: number;
  ccZeroAmountRowsIgnored: number;
  ccOptionalColumnsIgnored: number;
};

function toCents(n: number): number {
  return Math.round(n * 100);
}

/**
 * Scope a multi-account bank statement to the transaction-heavy account block.
 * Only activates when there are 2+ opening-balance/balance-forward anchors AND
 * one block clearly dominates — single-account statements are untouched (so the
 * passing baseline is unaffected).
 */
function scopeBankSection(lines: string[]): {
  scopedLines: string[];
  sectionsDetected: number;
  chosenLabel: string | null;
  ignored: number;
} {
  const anchors: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (/\b(opening balance|balance forward)\b/i.test(lines[i])) anchors.push(i);
  }
  if (anchors.length < 2) {
    return { scopedLines: lines, sectionsDetected: anchors.length, chosenLabel: null, ignored: 0 };
  }

  const blocks = anchors.map((a, idx) => ({
    start: a,
    end: idx + 1 < anchors.length ? anchors[idx + 1] : lines.length,
  }));
  const txCount = (b: { start: number; end: number }): number => {
    let c = 0;
    for (let i = b.start; i < b.end; i += 1) {
      const l = lines[i];
      const m = extractMoneyValues(l).length;
      if (findDate(l) && m >= 1) c += 1;
      else if (m >= 2) c += 1;
    }
    return c;
  };
  const counts = blocks.map(txCount);
  let maxIdx = 0;
  for (let i = 1; i < counts.length; i += 1) if (counts[i] > counts[maxIdx]) maxIdx = i;
  const sorted = [...counts].sort((a, b) => b - a);
  // Don't scope if no clear winner (avoids splitting a single real account).
  if (sorted[0] === 0 || (sorted.length > 1 && sorted[1] > sorted[0] * 0.25)) {
    return { scopedLines: lines, sectionsDetected: anchors.length, chosenLabel: null, ignored: 0 };
  }

  const chosen = blocks[maxIdx];
  let chosenLabel: string | null = null;
  // Look back for the section header, skipping balance/LOC/metadata lines.
  for (let i = chosen.start - 1; i >= 0 && i >= chosen.start - 5; i -= 1) {
    const l = lines[i].trim();
    if (!l) continue;
    if (/\b(opening|closing|previous|new) balance\b|\bloc limit\b|\bexp\b|balance forward/i.test(l)) {
      continue;
    }
    chosenLabel = l;
    break;
  }
  return {
    scopedLines: lines.slice(chosen.start, chosen.end),
    sectionsDetected: anchors.length,
    chosenLabel,
    ignored: anchors.length - 1,
  };
}

/**
 * Local, dependency-free reconciliation (kept here so the parser has no runtime
 * imports). Credit card: opening + debits - credits = closing. Bank account:
 * opening + credits - debits = closing.
 */
function reconcileCents(
  opening: number | null,
  closing: number | null,
  rows: TransactionRow[],
  mode: "credit-card" | "bank-account",
): CandidateBalance {
  const creditC = rows.reduce((s, r) => s + (r.credit !== null ? toCents(r.credit) : 0), 0);
  const debitC = rows.reduce((s, r) => s + (r.debit !== null ? toCents(r.debit) : 0), 0);
  if (opening === null || closing === null) {
    return { available: false, passed: false, diffCents: null };
  }
  const expected =
    mode === "credit-card"
      ? toCents(opening) + debitC - creditC
      : toCents(opening) + creditC - debitC;
  const diffCents = expected - toCents(closing);
  return { available: true, passed: diffCents === 0, diffCents };
}

/**
 * Score a candidate. Reconciliation dominates: the strategy whose debit/credit
 * mapping makes the statement balance wins. Other signals break ties.
 */
function scoreCandidate(c: Candidate): number {
  const rowCount = c.rows.length;
  if (rowCount === 0) return -1000;

  let s = 0;
  if (c.balance.available && c.balance.passed) s += 100;
  else if (c.balance.available && c.balance.diffCents !== null) {
    const d = Math.abs(c.balance.diffCents);
    if (d <= 100) s += 45; // within $1
    else if (d <= 1000) s += 15; // within $10
  }
  if (c.closingBalance !== null) s += 15;
  if (c.openingBalance !== null) s += 10;

  const creditC = c.rows.reduce((a, r) => a + (r.credit !== null ? toCents(r.credit) : 0), 0);
  const debitC = c.rows.reduce((a, r) => a + (r.debit !== null ? toCents(r.debit) : 0), 0);
  if (c.summary.credits !== null && Math.abs(creditC - toCents(c.summary.credits)) <= 1) s += 20;
  if (c.summary.debits !== null && Math.abs(debitC - toCents(c.summary.debits)) <= 1) s += 20;

  s += Math.min(rowCount, 50) * 0.4; // mild reward for completeness

  // Penalties: obvious junk and noise.
  const junk = c.rows.filter(
    (r) => !r.date.trim() || !r.description.trim() || (r.debit === null && r.credit === null),
  ).length;
  s -= junk * 4;
  const lowConf = c.rows.filter((r) => r.confidence < LOW_CONFIDENCE).length;
  s -= lowConf * 1;

  // Anti false-pass: a near-empty candidate that only "balances" because opening
  // and closing are the SAME value (e.g. a one-line "on your last statement..."
  // prose row that wrongly reused New Balance for both) cannot represent a
  // statement whose summary shows real activity. Heavily downgrade it so a real
  // itemized table candidate always wins. A genuine single-transaction statement
  // has distinct opening/closing, so it is not affected.
  const summaryActivity =
    (c.summary.credits !== null && Math.abs(c.summary.credits) >= 0.01) ||
    (c.summary.debits !== null && Math.abs(c.summary.debits) >= 0.01);
  const sameOpenClose =
    c.openingBalance !== null &&
    c.closingBalance !== null &&
    Math.abs(toCents(c.openingBalance) - toCents(c.closingBalance)) < 1;
  if (rowCount <= 1 && summaryActivity && sameOpenClose) s -= 150;

  return s;
}

// Strong signals that a credit-card statement uses the sectioned (CIBC-style)
// layout. When present, the sectioned candidate is preferred over simple.
const SECTIONED_SIGNAL_RE =
  /your payments|your interest|your new charges|spend categor|trans(?:\.|action)? date|post(?:ing)? date|amount\s*\(\s*\$\s*\)|total balance/i;

function buildCandidates(
  lines: string[],
  text: string,
  year: number | undefined,
  items?: PdfTextItem[],
): Candidate[] {
  const lower = text.toLowerCase();
  const looksCreditCard = CC_FAMILY_SIGNALS.some((re) => re.test(lower));
  const looksBank =
    BANK_FAMILY_SIGNALS.some((re) => re.test(lower)) ||
    (/withdrawals?/.test(lower) && /deposits?/.test(lower));
  const sectionedSignals = (text.match(SECTIONED_SIGNAL_RE) ? 1 : 0) > 0;
  const period = detectStatementPeriod(text);

  const candidates: Candidate[] = [];

  const noScope = {
    accountSectionsDetected: 0,
    chosenAccountSection: null,
    ignoredAccountSections: 0,
    balanceForwardHandled: 0,
    finalRunningBalanceUsedAsClosing: false,
    outOfPeriodRejected: 0,
    summaryStatisticalRejected: 0,
    legalInfoIgnored: 0,
    paymentRemittanceRejected: 0,
    fxRowsAttached: 0,
    feeCountRateNormalized: 0,
    formulaRateRowsDetected: 0,
    formulaRateRowsResolvedToPostedAmount: 0,
    formulaRateRowsUsedComputedTotal: 0,
    pageBottomRowsRecovered: 0,
    accountSectionOpeningSource: null,
    selectedSectionHadOpeningClosing: false,
    source: "text-parser" as CandidateSource,
    coord: null,
  };

  // ----- Tier 1: coordinate-aware table candidates (digital PDFs only) -----
  // These understand the table from text-item positions and column headers, so
  // direction comes from the column a value lands in — not from string rules.
  // They compete in the same reconciliation scorer; when coordinates are absent
  // (plain-text path) none are produced and behaviour is unchanged.
  if (items && items.length > 0) {
    const coordCandidates = parseCoordinateTables(items, year);
    for (const cc of coordCandidates) {
      candidates.push({
        name: "coordinate-table",
        statementKind: cc.statementKind,
        layoutFamily:
          cc.statementKind === "credit-card" ? "credit-card-table" : "bank-account-table",
        rows: cc.rows,
        openingBalance: cc.opening,
        closingBalance: cc.closing,
        summary: cc.summary,
        bankAttempted: cc.rows.length,
        bankIgnored: cc.diagnostics.summaryRowsIgnored,
        sectionsDetected: 0,
        ignoredSpendReportRows: 0,
        balance: reconcileCents(cc.opening, cc.closing, cc.rows, cc.statementKind),
        score: 0,
        ...noScope,
        source: "coordinate-table",
        fxRowsAttached: cc.diagnostics.fxDetailLinesAttached,
        coord: {
          tableCandidatesFound: cc.diagnostics.tableCandidatesFound,
          chosenTableType: cc.diagnostics.chosenTableType,
          headerColumnsDetected: cc.diagnostics.headerColumnsDetected,
          columnOrder: cc.diagnostics.columnOrder,
          rowsBuilt: cc.diagnostics.rowsBuilt,
          datelessRowsPromoted: cc.diagnostics.datelessRowsPromoted,
          wrappedDescriptionsJoined: cc.diagnostics.wrappedDescriptionsJoined,
          fxDetailLinesAttached: cc.diagnostics.fxDetailLinesAttached,
          summaryRowsIgnored: cc.diagnostics.summaryRowsIgnored,
          footerLegalRowsIgnored: cc.diagnostics.footerLegalRowsIgnored,
          stitched: cc.diagnostics.stitched,
          regionsStitched: cc.diagnostics.regionsStitched,
          ccRowsRejectedAsNonTx: cc.diagnostics.ccRowsRejectedAsNonTx,
          ccZeroAmountRowsIgnored: cc.diagnostics.ccZeroAmountRowsIgnored,
          ccOptionalColumnsIgnored: cc.diagnostics.ccOptionalColumnsIgnored,
        },
      });
    }
  }

  if (looksCreditCard) {
    const ccBalances = detectCreditCardBalances(lines);
    const ccSummary = detectCreditCardSummary(lines);
    for (const useSections of [false, true]) {
      const cc = parseCreditCardTransactions(lines, year, { useSections, period });
      candidates.push({
        name: useSections ? "credit-card-sectioned" : "credit-card-simple",
        statementKind: "credit-card",
        layoutFamily: "credit-card-table",
        rows: cc.rows,
        openingBalance: ccBalances.opening,
        closingBalance: ccBalances.closing,
        summary: ccSummary,
        creditCardStats: cc.stats,
        bankAttempted: cc.stats.blocksAttempted,
        bankIgnored: cc.stats.ignoredSummaryRows,
        sectionsDetected: cc.stats.sectionsDetected,
        ignoredSpendReportRows: cc.stats.ignoredSpendReportRows,
        balance: reconcileCents(ccBalances.opening, ccBalances.closing, cc.rows, "credit-card"),
        score: 0,
        ...noScope,
        outOfPeriodRejected: cc.stats.periodRejected,
        paymentRemittanceRejected: cc.stats.paymentRemittanceRejected,
        fxRowsAttached: cc.stats.fxRowsAttached,
        selectedSectionHadOpeningClosing:
          ccBalances.opening !== null && ccBalances.closing !== null,
      });
    }
  }

  if (looksBank) {
    const scope = scopeBankSection(lines);
    const makeBankCandidate = (
      bankLines: string[],
      chosenLabel: string | null,
      ignoredSections: number,
    ): Candidate => {
      const bankBalances = parseBankAccountStatement(bankLines, year);
      const table = parseBankAccountTable(
        bankLines,
        year,
        bankBalances.openingBalance,
        bankBalances.closingBalance,
      );
      // Use the last displayed running balance as closing when no explicit label.
      const usedRunningClosing =
        bankBalances.closingBalance === null && table.lastBalance !== null;
      const effectiveClosing = bankBalances.closingBalance ?? table.lastBalance;
      // Where did the section's opening figure come from? Helps explain scoping
      // without exposing any amount (label only).
      const openingSource =
        bankBalances.openingBalance === null
          ? null
          : bankLines.some((l) => /\bbalance forward\b/i.test(l))
            ? "balance forward"
            : bankLines.some((l) => /\b(opening|beginning|previous) balance\b/i.test(l))
              ? "opening balance"
              : "running balance";
      return {
        name: "bank-account",
        statementKind: "bank-account",
        layoutFamily: "bank-account-table",
        rows: table.rows,
        openingBalance: bankBalances.openingBalance,
        closingBalance: effectiveClosing,
        summary: detectBankSummary(bankLines),
        bankAttempted: table.attempted,
        bankIgnored: table.ignoredSummaryRows,
        sectionsDetected: 0,
        ignoredSpendReportRows: 0,
        balance: reconcileCents(
          bankBalances.openingBalance,
          effectiveClosing,
          table.rows,
          "bank-account",
        ),
        score: 0,
        accountSectionsDetected: scope.sectionsDetected,
        chosenAccountSection: chosenLabel,
        ignoredAccountSections: ignoredSections,
        balanceForwardHandled: table.balanceForwardHandled,
        finalRunningBalanceUsedAsClosing: usedRunningClosing,
        outOfPeriodRejected: table.outOfPeriodRejected,
        summaryStatisticalRejected: table.summaryStatisticalRejected,
        legalInfoIgnored: table.legalInfoIgnored,
        paymentRemittanceRejected: 0,
        fxRowsAttached: 0,
        feeCountRateNormalized: table.feeCountRateNormalized,
        formulaRateRowsDetected: table.formulaRateRowsDetected,
        formulaRateRowsResolvedToPostedAmount: table.formulaRateRowsResolvedToPostedAmount,
        formulaRateRowsUsedComputedTotal: table.formulaRateRowsUsedComputedTotal,
        pageBottomRowsRecovered: table.pageBottomRowsRecovered,
        accountSectionOpeningSource: openingSource,
        selectedSectionHadOpeningClosing:
          bankBalances.openingBalance !== null && effectiveClosing !== null,
        source: "text-parser",
        coord: null,
      };
    };

    // Always try the full document. If scoping narrowed to one account section,
    // also try the scoped version; reconciliation scoring picks the better one,
    // so single-account statements are never harmed by scoping.
    candidates.push(makeBankCandidate(lines, null, 0));
    const narrowed = scope.scopedLines.length !== lines.length;
    if (narrowed) {
      candidates.push(makeBankCandidate(scope.scopedLines, scope.chosenLabel, scope.ignored));
    }
  }

  // Fallback line parser is always available.
  const fb = parseBankAccountStatement(lines, year);
  candidates.push({
    name: "fallback",
    statementKind: "unknown",
    layoutFamily: "unknown",
    rows: fb.rows,
    openingBalance: fb.openingBalance,
    closingBalance: fb.closingBalance,
    summary: { credits: null, debits: null },
    bankAttempted: fb.rows.length,
    bankIgnored: 0,
    sectionsDetected: 0,
    ignoredSpendReportRows: 0,
    balance: reconcileCents(fb.openingBalance, fb.closingBalance, fb.rows, "bank-account"),
    score: 0,
    ...noScope,
    source: "fallback",
  });

  for (const c of candidates) {
    c.score = scoreCandidate(c);
    // When the layout clearly uses sectioned credit-card signals, prefer the
    // sectioned candidate and penalize a non-reconciling simple candidate.
    if (sectionedSignals) {
      if (c.name === "credit-card-sectioned") c.score += 30;
      if (c.name === "credit-card-simple" && !c.balance.passed) c.score -= 40;
    }
    // Rows that came from a detected table region are inherently more trustworthy
    // than line-reconstructed text (the column tells us debit vs credit directly).
    // A small base bonus breaks ties; when the coordinate candidate also fully
    // reconciles it gets a larger bonus so it is preferred over a text candidate
    // that merely matches layout signals. It still cannot beat a text candidate
    // that reconciles strictly better — a non-reconciling coordinate keeps only
    // the small bonus, so a passing text parse (+100) still wins.
    if (c.source === "coordinate-table") {
      c.score += 6;
      if (c.balance.available && c.balance.passed) c.score += 30;
    }
  }
  return candidates;
}

/**
 * Parse a full statement's extracted text into rows + balances + warnings.
 * `text` is the page text joined with newlines. Several candidate strategies are
 * tried and scored (reconciliation dominates); the highest-scoring one wins. If
 * none reconciles, the best-effort result is returned and the UI shows Needs
 * Review rather than pretending.
 */
export function parseStatementText(text: string, items?: PdfTextItem[]): ParseResult {
  // Stage B (normalize) is handled inside the line/money/date helpers; here we
  // split into trimmed non-empty lines and infer the statement period year used
  // for date normalization downstream.
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const year = detectStatementPeriodYear(text);
  // Stage C: advisory statement-profile detection (guides; never overrides the
  // generic parser). Recorded in diagnostics only.
  const profile = detectStatementProfile(text);
  const candidates = buildCandidates(lines, text, year, items);

  // Choose the highest-scoring candidate. Reconciliation dominates scoring, so a
  // candidate that balances is preferred over one that merely has more rows.
  const withRows = candidates.filter((c) => c.rows.length > 0);
  const pool = withRows.length > 0 ? withRows : candidates;
  const chosen = pool.reduce((best, c) => (c.score > best.score ? c : best), pool[0]);

  const rows = chosen.rows;
  const layoutFamily = chosen.layoutFamily;
  const statementKind = chosen.statementKind;
  const openingBalance = chosen.openingBalance;
  const closingBalance = chosen.closingBalance;

  // Stage G follow-up: same-day continuation rows in a bank-account table often
  // omit the printed date. The chosen candidate's rows are a single, already-
  // bounded transaction-table context (summaries/legal/page-furniture excluded,
  // section/stitch boundaries decided), so inheriting the most recent valid date is
  // a safe carry-forward — it fixes the coordinate stitched path (which rebuilds
  // rows per page and otherwise drops the date on a continued page's first rows)
  // and is a no-op where dates are already present. Credit-card rows are excluded
  // (each CC transaction prints its own date; dateless CC amounts are rejected).
  const rowsDateInherited =
    statementKind === "bank-account" ? carryForwardRowDates(rows) : 0;

  const candidateComparison: CandidateComparison[] = candidates.map((c) => ({
    name: c.name,
    score: Math.round(c.score),
    rowCount: c.rows.length,
    totalCredits: c.rows.reduce((a, r) => a + (r.credit ?? 0), 0),
    totalDebits: c.rows.reduce((a, r) => a + (r.debit ?? 0), 0),
    openingDetected: c.openingBalance !== null,
    closingDetected: c.closingBalance !== null,
    balanceStatus: !c.balance.available ? "limited" : c.balance.passed ? "passed" : "needs-review",
    balanceDiff: c.balance.diffCents !== null ? c.balance.diffCents / 100 : null,
  }));

  const parseStats: LayoutParseStats = {
    layoutFamily,
    candidate: chosen.name,
    candidateScore: Math.round(chosen.score),
    candidatesTried: candidates.length,
    creditCardTableDetected: layoutFamily === "credit-card-table",
    bankAccountTableDetected: layoutFamily === "bank-account-table",
    transactionSectionsDetected: chosen.sectionsDetected,
    rowsAttempted: chosen.bankAttempted,
    rowsCompleted: rows.length,
    amountColumnRows: rows.filter((r) => r.debit !== null || r.credit !== null).length,
    debitColumnRows: rows.filter((r) => r.debit !== null).length,
    creditColumnRows: rows.filter((r) => r.credit !== null).length,
    balanceColumnRows: rows.filter((r) => r.balance !== null).length,
    ignoredSummaryRows: chosen.bankIgnored,
    ignoredSpendReportRows: chosen.ignoredSpendReportRows,
    candidateComparison,
    accountSectionsDetected: chosen.accountSectionsDetected,
    chosenAccountSection: chosen.chosenAccountSection,
    ignoredAccountSections: chosen.ignoredAccountSections,
    transactionTableStartFound:
      chosen.sectionsDetected > 0 ||
      lines.some((l) => BANK_START_RE.test(l) || isTransactionHeader(l)),
    summaryRowsUsedForValidation:
      (openingBalance !== null ? 1 : 0) +
      (closingBalance !== null ? 1 : 0) +
      (chosen.summary.credits !== null ? 1 : 0) +
      (chosen.summary.debits !== null ? 1 : 0),
    summaryRowsIgnoredAsTransactions: chosen.bankIgnored,
    balanceForwardRowsHandled: chosen.balanceForwardHandled,
    finalRunningBalanceUsedAsClosing: chosen.finalRunningBalanceUsedAsClosing,
    outOfPeriodRowsRejected: chosen.outOfPeriodRejected,
    accountFeeSummaryRowsIgnored: lines.filter((l) => /^account fees?\b/i.test(l)).length,
    subtotalRowsIgnored: lines.filter((l) => /subtotal of monthly activity/i.test(l)).length,
    summaryStatisticalRowsRejected: chosen.summaryStatisticalRejected,
    legalInfoRowsIgnored: chosen.legalInfoIgnored,
    paymentRemittanceRowsIgnored: chosen.paymentRemittanceRejected,
    fxRowsAttached: chosen.fxRowsAttached,
    feeCountRateRowsNormalized: chosen.feeCountRateNormalized,
    accountSectionOpeningSource: chosen.accountSectionOpeningSource,
    selectedSectionHadOpeningClosing: chosen.selectedSectionHadOpeningClosing,
    coordinateExtractionAvailable: candidates.some((c) => c.source === "coordinate-table"),
    tableCandidatesFound: chosen.coord?.tableCandidatesFound ?? 0,
    chosenTableType: chosen.coord?.chosenTableType ?? null,
    coordHeaderColumnsDetected: chosen.coord?.headerColumnsDetected ?? 0,
    coordColumnOrder: chosen.coord?.columnOrder ?? null,
    coordRowsBuilt: chosen.coord?.rowsBuilt ?? 0,
    coordDatelessRowsPromoted: chosen.coord?.datelessRowsPromoted ?? 0,
    coordWrappedDescriptionsJoined: chosen.coord?.wrappedDescriptionsJoined ?? 0,
    coordFxDetailLinesAttached: chosen.coord?.fxDetailLinesAttached ?? 0,
    coordSummaryRowsIgnored: chosen.coord?.summaryRowsIgnored ?? 0,
    coordFooterLegalRowsIgnored: chosen.coord?.footerLegalRowsIgnored ?? 0,
    coordStitched: chosen.coord?.stitched ?? false,
    coordRegionsStitched: chosen.coord?.regionsStitched ?? 0,
    coordCcRowsRejectedAsNonTx: chosen.coord?.ccRowsRejectedAsNonTx ?? 0,
    coordCcZeroAmountRowsIgnored: chosen.coord?.ccZeroAmountRowsIgnored ?? 0,
    coordCcOptionalColumnsIgnored: chosen.coord?.ccOptionalColumnsIgnored ?? 0,
    finalBalanceDifference: chosen.balance.diffCents !== null ? chosen.balance.diffCents / 100 : null,
    chosenCandidateSource: chosen.source,
    detectedProfile: profile.name,
    coordHeaderProbe: probeCoordinateHeaders(items ?? []),
    // Safe date-normalization diagnostics (counts/labels only).
    statementPeriodDetected: detectStatementDateContext(text) !== null,
    inferredDateYearSource: detectStatementDateContext(text) !== null
      ? "statement-period"
      : year !== undefined
        ? "fallback-year"
        : "none",
    rowsMissingDateAfterNormalization: rows.filter((r) => !r.date.trim()).length,
    malformedDatesAfterNormalization: rows.filter(
      (r) => r.date.trim() !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(r.date),
    ).length,
    // Statement-level category-column context: true when ANY coordinate region
    // detected a category column OR a header line names one (covers the text-parser
    // / sectioned-CC winning paths whose own column order omits the coordinate
    // "category" marker). This is what survives to the final cleanup. The two
    // counts are populated by the model-build cleanup (buildParsedStatement).
    categoryColumnContextDetected:
      candidates.some((c) => (c.coord?.columnOrder ?? "").includes("category")) ||
      detectCategoryColumnContext(lines),
    ambiguousCategoriesStripped: 0,
    metadataCategoriesCaptured: 0,
    rowsDateInherited,
    rowsStillMissingDate: rows.filter((r) => !r.date.trim()).length,
    // Populated by the model-build description normalization (buildParsedStatement).
    eTransferDescriptionsNormalized: 0,
    rawReferenceFragmentsRemoved: 0,
    formulaRateRowsDetected: chosen.formulaRateRowsDetected,
    formulaRateRowsResolvedToPostedAmount: chosen.formulaRateRowsResolvedToPostedAmount,
    formulaRateRowsUsedComputedTotal: chosen.formulaRateRowsUsedComputedTotal,
    pageBottomRowsRecovered: chosen.pageBottomRowsRecovered,
    // Path-agnostic: any chosen row carrying an amount but no running balance.
    rowsAcceptedWithoutRunningBalance: rows.filter(
      (r) => (r.debit !== null || r.credit !== null) && r.balance === null,
    ).length,
  };

  const warnings: string[] = [];
  if (rows.length === 0) warnings.push(NO_ROWS_WARNING);
  if (openingBalance === null || closingBalance === null) {
    warnings.push(MISSING_BALANCE_WARNING);
  }

  return {
    statementKind,
    layoutFamily,
    rows,
    openingBalance,
    closingBalance,
    summary: chosen.summary,
    warnings,
    creditCardStats: chosen.creditCardStats,
    parseStats,
  };
}
