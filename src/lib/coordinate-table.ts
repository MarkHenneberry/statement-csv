// Coordinate-aware transaction-table extraction for digital (text-based) PDFs.
//
// This is a REUSABLE, layout-driven layer — it understands transaction tables
// from PDF text-item positions (visual lines, header columns, x-ranges) instead
// of from reconstructed plain text and bank-specific string rules. It produces
// candidate parse results that compete in the existing reconciliation scorer
// (see parser.ts). When coordinates are unavailable (e.g. the plain-text path),
// nothing here runs and the existing text parser is used unchanged.
//
// PRIVACY: this module only computes structured rows and aggregate counters. It
// never logs or exposes raw text, coordinates, names, addresses, account
// numbers, or descriptions. Callers must keep coordinates internal.

import type { TransactionRow } from "@/lib/upload";
import {
  extractMoneyValues,
  normalizeDate,
  findDate,
  parseDayMonthDate,
  resolveDayMonthDate,
  detectStatementDateContext,
  detectBalanceLine,
  detectCreditCardBalances,
  detectBankSummary,
  detectCreditCardSummary,
  cleanDescription,
  splitTrailingSpendCategory,
  type StatementKind,
  type StatementDateContext,
} from "./parser.ts";

// ----- Structured PDF text items (the coordinate-aware input) -----

export type PdfTextItem = {
  page: number;
  str: string;
  x: number; // left edge (PDF user units; origin bottom-left, x grows right)
  y: number; // text baseline (y grows UP the page)
  width: number;
  height: number;
};

export type VisualLineItem = { x: number; width: number; str: string };

export type VisualLine = {
  page: number;
  y: number;
  items: VisualLineItem[]; // sorted left-to-right by x
  text: string; // full reconstructed line text
};

// Normalized column meanings the table mapper targets.
export type ColumnMeaning =
  | "date"
  | "postDate"
  | "description"
  | "debit"
  | "credit"
  | "amount"
  | "balance"
  | "category";

export type TableColumn = {
  meaning: ColumnMeaning;
  header: string;
  xStart: number;
  xEnd: number;
  center: number;
};

export type CoordTableDiagnostics = {
  coordinateAvailable: boolean;
  tableCandidatesFound: number;
  chosenTableType: StatementKind | null;
  headerColumnsDetected: number;
  columnOrder: string | null;
  rowsBuilt: number;
  datelessRowsPromoted: number;
  wrappedDescriptionsJoined: number;
  fxDetailLinesAttached: number;
  summaryRowsIgnored: number;
  footerLegalRowsIgnored: number;
  finalBalanceDifference: number | null;
  /** True when this candidate combines multiple compatible regions. */
  stitched: boolean;
  /** Number of regions combined (1 for a single-region candidate). */
  regionsStitched: number;
  /** Credit-card amount rows rejected as summary/metadata (no date context). */
  ccRowsRejectedAsNonTx: number;
  /** Zero-amount itemized lines ignored (e.g. "Interest Charge on Cash Advances $0.00"). */
  ccZeroAmountRowsIgnored: number;
  /** Optional columns (category/posting date) present and not used for amounts. */
  ccOptionalColumnsIgnored: number;
};

export type CoordTableCandidate = {
  statementKind: "credit-card" | "bank-account";
  rows: TransactionRow[];
  opening: number | null;
  closing: number | null;
  summary: { credits: number | null; debits: number | null };
  columnOrder: string;
  headerColumns: number;
  confidence: number;
  diagnostics: CoordTableDiagnostics;
};

// ----- 1. Visual line grouping -----

/**
 * Group text items into visual lines by page and y-position (with tolerance for
 * sub-pixel baseline jitter), each line's items sorted left-to-right.
 */
export function groupVisualLines(items: PdfTextItem[], tolerance = 2.2): VisualLine[] {
  const byPage = new Map<number, PdfTextItem[]>();
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const arr = byPage.get(it.page);
    if (arr) arr.push(it);
    else byPage.set(it.page, [it]);
  }

  const lines: VisualLine[] = [];
  const pages = [...byPage.keys()].sort((a, b) => a - b);
  for (const page of pages) {
    const pageItems = byPage.get(page)!;
    const buckets: { y: number; items: PdfTextItem[] }[] = [];
    for (const it of pageItems) {
      let bucket = buckets.find((b) => Math.abs(b.y - it.y) <= tolerance);
      if (!bucket) {
        bucket = { y: it.y, items: [] };
        buckets.push(bucket);
      }
      bucket.items.push(it);
    }
    // Top-to-bottom: y grows up, so descending.
    buckets.sort((a, b) => b.y - a.y);
    for (const b of buckets) {
      const sorted = b.items.slice().sort((a, c) => a.x - c.x);
      const text = sorted
        .map((s) => s.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (!text) continue;
      lines.push({
        page,
        y: b.y,
        items: sorted.map((s) => ({ x: s.x, width: s.width, str: s.str })),
        text,
      });
    }
  }
  return lines;
}

// ----- 2/3. Header detection (column families, not bank names) -----

// Header phrase → normalized meaning. Order matters: more specific first so e.g.
// "posting date" is not swallowed by "date".
const HEADER_PATTERNS: { meaning: ColumnMeaning; re: RegExp }[] = [
  { meaning: "postDate", re: /^(posting date|post date|post\.? date)$/ },
  { meaning: "date", re: /^(transaction date|trans\.? date|tran\.? date|date)$/ },
  {
    meaning: "description",
    re: /^(activity description|transaction details|description|details|particulars|merchant|payee)$/,
  },
  {
    meaning: "debit",
    re: /^(cheque\s*\/?\s*debit|chq\s*\/?\s*debit|withdrawals?|amounts?\s+debited|debits?|payments?\s*\/?\s*debits?|charges?\s*\/?\s*debits?)$/,
  },
  {
    meaning: "credit",
    re: /^(deposits?\s*\/?\s*credits?|amounts?\s+credited|deposits?|credits?)$/,
  },
  { meaning: "amount", re: /^(amount\s*\(\s*\$\s*\)|amount\s*\$|amount)$/ },
  { meaning: "balance", re: /^(running balance|balance)$/ },
  { meaning: "category", re: /^(spend categories|categories|category)$/ },
];

/**
 * Strip generic, reusable header noise so a real header cell matches the core
 * phrase: a trailing currency/unit parenthetical ("Amount ($)", "Balance (CAD)"),
 * a trailing colon/bullet ("Balance:"), or a trailing standalone currency unit
 * ("Withdrawals CAD"). No bank/merchant/file-specific strings.
 */
function normalizeHeaderText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*[:•·]+\s*$/, "")
    .replace(/\s*\(\s*(?:\$|cad|usd|c\$|us\$)\s*\)\s*$/i, "")
    .replace(/\s+(?:cad|usd|c\$|us\$)\s*$/i, "")
    .trim();
}

/**
 * Resolve a header cell to a normalized column meaning. Matching is on the
 * noise-stripped text, so suffixed/units variants resolve without loosening the
 * core anchored phrase set (avoids false positives on description text).
 * `stats.relaxed` counts cells that only matched after noise-stripping.
 */
function matchHeaderMeaning(text: string, stats?: DetectStats): ColumnMeaning | null {
  const raw = text.toLowerCase().replace(/\s+/g, " ").trim();
  const norm = normalizeHeaderText(text);
  for (const { meaning, re } of HEADER_PATTERNS) {
    if (re.test(norm)) {
      if (stats && norm !== raw && !re.test(raw)) stats.relaxedHeaderMatches += 1;
      return meaning;
    }
  }
  return null;
}

/** Detection-level aggregate counters (safe; counts only, no text). */
export type DetectStats = {
  relaxedHeaderMatches: number;
  splitHeaderCandidates: number;
};

/**
 * Map a visual line's items into header columns, greedily merging up to 4
 * adjacent items so multi-word headers ("Transaction Date", "Cheque/Debit")
 * resolve. Returns the columns sorted left-to-right (one per distinct meaning).
 */
export function detectHeaderColumns(line: VisualLine, stats?: DetectStats): TableColumn[] {
  const items = line.items;
  const cols: TableColumn[] = [];
  const seen = new Set<ColumnMeaning>();
  let i = 0;
  while (i < items.length) {
    let matched: ColumnMeaning | null = null;
    let end = i;
    for (let w = Math.min(4, items.length - i); w >= 1; w -= 1) {
      const slice = items.slice(i, i + w);
      const text = slice.map((s) => s.str).join(" ");
      const m = matchHeaderMeaning(text, stats);
      if (m) {
        matched = m;
        end = i + w;
        break;
      }
    }
    if (matched && !seen.has(matched)) {
      seen.add(matched);
      const slice = items.slice(i, end);
      const xStart = slice[0].x;
      const last = slice[slice.length - 1];
      const xEnd = last.x + (last.width || 0);
      cols.push({
        meaning: matched,
        header: slice.map((s) => s.str).join(" "),
        xStart,
        xEnd,
        center: (xStart + xEnd) / 2,
      });
      i = end;
    } else {
      i += 1;
    }
  }
  cols.sort((a, b) => a.xStart - b.xStart);
  return cols;
}

/** Does this set of columns look like a real transaction-table header? */
function isTableHeader(cols: TableColumn[]): boolean {
  if (cols.length < 2) return false;
  const has = (m: ColumnMeaning) => cols.some((c) => c.meaning === m);
  const anchor = has("date") || has("description");
  const value = has("amount") || has("debit") || has("credit") || has("balance");
  return anchor && value;
}

/** Guess the statement kind from the detected columns. */
function kindFromColumns(cols: TableColumn[]): "credit-card" | "bank-account" {
  const has = (m: ColumnMeaning) => cols.some((c) => c.meaning === m);
  if ((has("debit") || has("credit")) && !has("amount")) return "bank-account";
  if (has("postDate")) return "credit-card";
  if (has("balance")) return "bank-account";
  if (has("amount")) return "credit-card";
  return "bank-account";
}

export type TableRegion = {
  headerIndex: number;
  page: number;
  columns: TableColumn[];
  statementKind: "credit-card" | "bank-account";
  confidence: number;
};

/** Merge two visual lines into one synthetic line (items unioned, sorted by x). */
function mergeTwoLines(a: VisualLine, b: VisualLine): VisualLine {
  const items = [...a.items, ...b.items].slice().sort((p, q) => p.x - q.x);
  return {
    page: a.page,
    y: Math.min(a.y, b.y),
    items,
    text: items.map((s) => s.str).join(" ").replace(/\s+/g, " ").trim(),
  };
}

/**
 * Find every header row. A header is normally one visual line, but real tables
 * often STACK the header across two nearby lines (e.g. "Transaction"/"Date" or
 * value-column headers printed a line below "Date Description"). When a single
 * line is not a full header, we try merging it with the adjacent line and, if the
 * union resolves to more columns and both lines individually carried header
 * tokens, treat the pair as one logical header (data starts after the lower line).
 */
export function detectTableRegions(lines: VisualLine[], stats?: DetectStats): TableRegion[] {
  const regions: TableRegion[] = [];
  let i = 0;
  while (i < lines.length) {
    const cols = detectHeaderColumns(lines[i], stats);

    // Stacked-header attempt: merge with the next line on the same page. This is
    // tried even when the single line is already a (possibly incomplete) header,
    // because the value/date columns are often printed a line above or below — the
    // merged header is preferred when it resolves strictly MORE columns. A data
    // line contributes no header tokens (nextCols=0), so header+data never merges.
    const next = i + 1 < lines.length ? lines[i + 1] : null;
    if (next && next.page === lines[i].page && cols.length >= 1) {
      const nextCols = detectHeaderColumns(next);
      if (nextCols.length >= 1) {
        const merged = detectHeaderColumns(mergeTwoLines(lines[i], next));
        if (
          isTableHeader(merged) &&
          merged.length > cols.length &&
          merged.length > nextCols.length
        ) {
          if (stats) stats.splitHeaderCandidates += 1;
          regions.push({
            headerIndex: i + 1, // data starts after the lower header line
            page: lines[i].page,
            columns: merged,
            statementKind: kindFromColumns(merged),
            confidence: Math.min(1, merged.length / 5 + 0.3),
          });
          i += 2;
          continue;
        }
      }
    }

    if (isTableHeader(cols)) {
      regions.push({
        headerIndex: i,
        page: lines[i].page,
        columns: cols,
        statementKind: kindFromColumns(cols),
        confidence: Math.min(1, cols.length / 5 + 0.3),
      });
      i += 1;
      continue;
    }
    i += 1;
  }
  return regions;
}

// ----- Coordinate header-detection telemetry (safe aggregates) -----

/**
 * Safe, aggregate-only telemetry about WHY coordinate table detection did or did
 * not find a header. Every field is a number/boolean derived from item positions
 * and column-meaning matches — it contains NO text from the document, so it can
 * be surfaced in dev diagnostics without leaking statement content.
 */
export type CoordinateHeaderProbe = {
  coordinateItemsPresent: boolean;
  visualLineCount: number;
  maxItemsPerLine: number;
  /** Lines where at least one header column-meaning resolved. */
  linesWithAnyHeaderToken: number;
  /** Best (max) count of distinct column meanings found on any single line. */
  bestDistinctMeaningsOnALine: number;
  /** Lines with a date/description anchor but no value column (split header?). */
  linesWithAnchorButNoValue: number;
  /** Lines with a value column but no date/description anchor (split header?). */
  linesWithValueButNoAnchor: number;
  /** Table regions detected (0 means detection failed → text fallback). */
  tableRegionsFound: number;
  /** Header cells that only matched after noise-stripping (suffixes/units). */
  relaxedHeaderMatches: number;
  /** Stacked headers merged across two visual lines into one logical header. */
  splitHeaderCandidates: number;
  /** Whether a conservative headerless x-clustering candidate is available. */
  headerlessCandidateAvailable: boolean;
  /** Multi-region stitched candidates attempted. */
  stitchCandidatesTried: number;
  /** Regions absorbed into a multi-region stitch group. */
  stitchRegionsStitched: number;
  /** Region adjacencies rejected for stitching. */
  stitchRejectedCount: number;
  /** Counts of stitch-reject reasons (labels only, no document text). */
  stitchRejectReasons: Record<string, number>;
  /** Adjacencies joined via relaxed (optional-column) compatibility. */
  stitchRelaxedCompatibilityUsed: number;
};

export const EMPTY_HEADER_PROBE: CoordinateHeaderProbe = {
  coordinateItemsPresent: false,
  visualLineCount: 0,
  maxItemsPerLine: 0,
  linesWithAnyHeaderToken: 0,
  bestDistinctMeaningsOnALine: 0,
  linesWithAnchorButNoValue: 0,
  linesWithValueButNoAnchor: 0,
  tableRegionsFound: 0,
  relaxedHeaderMatches: 0,
  splitHeaderCandidates: 0,
  headerlessCandidateAvailable: false,
  stitchCandidatesTried: 0,
  stitchRegionsStitched: 0,
  stitchRejectedCount: 0,
  stitchRejectReasons: {},
  stitchRelaxedCompatibilityUsed: 0,
};

/**
 * Compute header-detection telemetry from coordinate items. Pure and read-only;
 * does not change any parse outcome. Reuses the same grouping/header logic the
 * real detector uses, so the counts explain its behaviour exactly.
 */
export function probeCoordinateHeaders(items: PdfTextItem[]): CoordinateHeaderProbe {
  if (!items || items.length === 0) return EMPTY_HEADER_PROBE;
  const lines = groupVisualLines(items);
  let maxItemsPerLine = 0;
  let linesWithAnyHeaderToken = 0;
  let bestDistinctMeaningsOnALine = 0;
  let linesWithAnchorButNoValue = 0;
  let linesWithValueButNoAnchor = 0;

  for (const line of lines) {
    if (line.items.length > maxItemsPerLine) maxItemsPerLine = line.items.length;
    const cols = detectHeaderColumns(line);
    if (cols.length === 0) continue;
    linesWithAnyHeaderToken += 1;
    if (cols.length > bestDistinctMeaningsOnALine) bestDistinctMeaningsOnALine = cols.length;
    const has = (m: ColumnMeaning) => cols.some((c) => c.meaning === m);
    const anchor = has("date") || has("description");
    const value = has("amount") || has("debit") || has("credit") || has("balance");
    if (anchor && !value) linesWithAnchorButNoValue += 1;
    if (value && !anchor) linesWithValueButNoAnchor += 1;
  }

  const stats: DetectStats = { relaxedHeaderMatches: 0, splitHeaderCandidates: 0 };
  const regions = detectTableRegions(lines, stats);
  // A headerless candidate is only relevant (and only attempted) when no header
  // region was found AND there are enough aligned transaction-like rows.
  const headerlessCandidateAvailable =
    regions.length === 0 && transactionLikeLines(lines).rows.length >= 4;
  const ends = regions.map((_, r) => regionEnd(lines, regions, r));
  const plan = planStitch(lines, regions, ends);

  return {
    coordinateItemsPresent: true,
    visualLineCount: lines.length,
    maxItemsPerLine,
    linesWithAnyHeaderToken,
    bestDistinctMeaningsOnALine,
    linesWithAnchorButNoValue,
    linesWithValueButNoAnchor,
    tableRegionsFound: regions.length,
    relaxedHeaderMatches: stats.relaxedHeaderMatches,
    splitHeaderCandidates: stats.splitHeaderCandidates,
    headerlessCandidateAvailable,
    stitchCandidatesTried: plan.stitchedCandidatesTried,
    stitchRegionsStitched: plan.regionsStitched,
    stitchRejectedCount: plan.rejectedCount,
    stitchRejectReasons: plan.rejectReasons,
    stitchRelaxedCompatibilityUsed: plan.relaxedCompatibilityUsed,
  };
}

// ----- 3. Conservative headerless x-clustering fallback -----

// A standalone money token (so we can cluster value columns by item x-position).
const MONEY_TOKEN_RE = /^\(?\$?\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?-?\)?$|^\(?\$?\s?\d+\.\d{2}-?\)?$/;
// A self-contained numeric date token (split month-name dates are handled by the
// description fallback, not as a date column).
const DATE_TOKEN_RE = /^(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})$/;

/** Cluster x-centers into zones (1D agglomerative within a tolerance). */
function clusterCenters(centers: number[], tol = 18): { center: number; count: number }[] {
  const sorted = [...centers].sort((a, b) => a - b);
  const zones: { sum: number; count: number; center: number }[] = [];
  for (const c of sorted) {
    const z = zones[zones.length - 1];
    if (z && c - z.center <= tol) {
      z.sum += c;
      z.count += 1;
      z.center = z.sum / z.count;
    } else {
      zones.push({ sum: c, count: 1, center: c });
    }
  }
  return zones.map((z) => ({ center: z.center, count: z.count }));
}

type TxScan = {
  rows: number[]; // indices of transaction-like lines
  moneyCenters: number[];
  dateCenters: number[];
  firstIdx: number;
  lastIdx: number;
};

/**
 * Identify transaction-like lines (a money token plus either a date token or
 * descriptive text), excluding summary/footer/balance lines. Used by both the
 * headerless detector and the probe. Read-only; counts/positions only.
 */
function transactionLikeLines(lines: VisualLine[]): TxScan {
  const rows: number[] = [];
  const moneyCenters: number[] = [];
  const dateCenters: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i];
    if (COORD_STOP_RE.test(l.text)) break;
    if (COORD_IGNORE_RE.test(l.text) || detectBalanceLine(l.text)) continue;
    const moneyItems = l.items.filter((it) => MONEY_TOKEN_RE.test(it.str.trim()));
    if (moneyItems.length === 0) continue;
    const dateItem = l.items.find((it) => DATE_TOKEN_RE.test(it.str.trim()));
    const hasText = l.items.some((it) => /[A-Za-z]{3,}/.test(it.str));
    if (!dateItem && !hasText) continue;
    rows.push(i);
    for (const m of moneyItems) moneyCenters.push(m.x + (m.width || 0) / 2);
    if (dateItem) dateCenters.push(dateItem.x + (dateItem.width || 0) / 2);
  }
  return {
    rows,
    moneyCenters,
    dateCenters,
    firstIdx: rows.length ? rows[0] : -1,
    lastIdx: rows.length ? rows[rows.length - 1] : -1,
  };
}

function syntheticColumn(meaning: ColumnMeaning, center: number): TableColumn {
  return { meaning, header: meaning, xStart: center - 1, xEnd: center + 1, center };
}

/**
 * Build ONE conservative coordinate candidate from x-clustering when no header
 * region was found. It only fires for a clean aligned table (≥4 transaction-like
 * rows, 1–3 stable money columns); the candidate still must reconcile to win, so
 * a wrong guess loses to the text fallback.
 */
function detectHeaderlessRegion(
  lines: VisualLine[],
): { region: TableRegion; end: number } | null {
  const scan = transactionLikeLines(lines);
  if (scan.rows.length < 4) return null;

  const moneyZones = clusterCenters(scan.moneyCenters)
    .filter((z) => z.count >= Math.max(2, Math.floor(scan.rows.length * 0.4)))
    .sort((a, b) => a.center - b.center);
  if (moneyZones.length < 1 || moneyZones.length > 3) return null;

  const dateZones = clusterCenters(scan.dateCenters).filter(
    (z) => z.count >= scan.rows.length * 0.5,
  );
  const hasDate = dateZones.length >= 1;

  const cols: TableColumn[] = [];
  if (hasDate) cols.push(syntheticColumn("date", dateZones[0].center));
  const firstMoney = moneyZones[0].center;
  const descCenter = hasDate ? (dateZones[0].center + firstMoney) / 2 : firstMoney / 2;
  cols.push(syntheticColumn("description", descCenter));
  if (moneyZones.length === 1) {
    cols.push(syntheticColumn("amount", moneyZones[0].center));
  } else if (moneyZones.length === 2) {
    cols.push(syntheticColumn("amount", moneyZones[0].center));
    cols.push(syntheticColumn("balance", moneyZones[1].center));
  } else {
    cols.push(syntheticColumn("debit", moneyZones[0].center));
    cols.push(syntheticColumn("credit", moneyZones[1].center));
    cols.push(syntheticColumn("balance", moneyZones[2].center));
  }
  cols.sort((a, b) => a.center - b.center);

  const statementKind = cols.some((c) => c.meaning === "balance")
    ? "bank-account"
    : "credit-card";
  const region: TableRegion = {
    headerIndex: scan.firstIdx - 1,
    page: lines[scan.firstIdx].page,
    columns: cols,
    statementKind,
    confidence: 0.4,
  };
  return { region, end: scan.lastIdx + 1 };
}

// ----- 4. Column boundaries from x positions -----

/** Build [left,right) x-boundaries for each column from header centers. */
function columnBounds(cols: TableColumn[]): { left: number; right: number }[] {
  return cols.map((c, idx) => {
    const left = idx === 0 ? -Infinity : (cols[idx - 1].center + c.center) / 2;
    const right = idx === cols.length - 1 ? Infinity : (c.center + cols[idx + 1].center) / 2;
    return { left, right };
  });
}

/** Assign a visual line's items to columns by x-center; returns per-column text. */
function assignCells(line: VisualLine, cols: TableColumn[]): string[] {
  const bounds = columnBounds(cols);
  const cells: string[][] = cols.map(() => []);
  for (const it of line.items) {
    const center = it.x + (it.width || 0) / 2;
    let idx = 0;
    for (let k = 0; k < bounds.length; k += 1) {
      if (center >= bounds[k].left && center < bounds[k].right) {
        idx = k;
        break;
      }
    }
    cells[idx].push(it.str);
  }
  return cells.map((c) => c.join(" ").replace(/\s+/g, " ").trim());
}

// ----- Summary / footer / ignore detection (reusable, not bank-specific) -----

// Lines that validate totals or are page furniture — never transaction rows.
const COORD_IGNORE_RE =
  /credit limit|available credit|minimum payment|amount past due|payment due|payment slip|payment options|remittance|please pay|total payment enclosed|new balance|previous (?:account |statement )?balance|opening balance|closing balance|balance forward|beginning balance|ending balance|total (?:account )?balance|statement balance|total (?:debits?|credits?|withdrawals?|deposits?|purchases?|charges?|payments?|fees?|interest)|amounts? (?:debited|credited)|number of items|no\.? of items|monthly (?:aver|min|average|minimum)|average (?:cr|dr|daily)?\.? ?bal|next statement|statement date|subtotal of monthly activity|total fees for this period|total interest for this period|interest charged|fees charged|page \d+ of \d+/i;

// Hard stop: legal/info/footer region — nothing after it on the page is a row.
// "interest rate chart" / "time to pay" mark the end of the transaction table on
// credit-card statements (the rate table / repayment estimator follow).
const COORD_STOP_RE =
  /important (?:information about your account|account information)|how to (?:reach|contact) us|trade ?-?marks?|closing notice|protecting your|interest rate chart|time to pay/i;

// A barrier between two regions that must STOP stitching: legal/footer (above)
// plus remittance/payment-slip/interest-rate sections. A continuation page never
// contains these between its transaction blocks; a new statement section does.
const STITCH_BARRIER_RE =
  /important (?:information about your account|account information)|how to (?:reach|contact) us|trade ?-?marks?|closing notice|protecting your|payment slip|remittance|please pay|amount past due|interest rate chart|time to pay|total payment enclosed/i;

// Credit-card single-amount tables print one Amount column: purchases, fees, and
// interest are debits; payments/credits/refunds are credits. Sign/CR is the
// primary signal; when an amount has NO sign, these description keywords mark the
// row as a credit. Conservative (clear payment/credit words only) so a normal
// purchase stays a debit. Generic, not bank-specific.
const CC_CREDIT_DESC_RE =
  /\bpayment\b|thank ?you|paiement|\bmerci\b|\brefund\b|\breturn(?:ed)?\b|credit voucher|\breversal\b|\brebate\b|cash ?back|\badjustment\b|\bcredit\b/i;

/** Should a single, unsigned credit-card amount be treated as a credit (payment/refund)? */
function ccDescriptionIsCredit(desc: string): boolean {
  return CC_CREDIT_DESC_RE.test(desc);
}

// Foreign-currency / exchange detail sub-line (attached to the row above).
function isFxDetail(text: string): boolean {
  return (
    /foreign currenc|exchange rate|currency conversion|conversion rate/i.test(text) ||
    (/\b(usd|eur|gbp|aud|jpy|mxn|cad)\b/i.test(text) && /@|exchange|rate|\d/i.test(text))
  );
}

/** A long all-digit cell is a reference/authorization number, not money/desc. */
function isReferenceText(text: string): boolean {
  const d = text.replace(/\s/g, "");
  return /^\d{8,}$/.test(d);
}

/**
 * Resolve a date column cell to ISO. Uses findDate so a cell that holds more than
 * one token (a combined transaction+posting date like "APR 22 APR 24", or a date
 * with stray tokens) still yields the FIRST real date — the transaction date.
 */
function cellDate(
  raw: string,
  year: number | undefined,
  ctx?: StatementDateContext | null,
  dayFirst?: boolean,
): string | null {
  if (!raw) return null;
  const direct = normalizeDate(raw, year);
  if (direct) return direct;
  const d = findDate(raw);
  if (d) return normalizeDate(d.match, year);
  // Last resort: a bare day/month date (e.g. "23/01" or a "23/01 24/01" pair) that
  // findDate does not recognize. The cell is already known to be the date column.
  // Use the statement period context to pick the day/month order AND the correct
  // year (which can differ across a December→January boundary). Take the FIRST
  // day/month token (the transaction date) when a posting date is also present.
  const dm = raw.match(/\b\d{1,2}[/-]\d{1,2}\b/);
  if (!dm) return null;
  // With a known order/period, resolve precisely; else fall back to the legacy
  // MM/DD-default parser with the single fallback year.
  if (ctx || dayFirst !== undefined) {
    return resolveDayMonthDate(dm[0], ctx ?? null, dayFirst ?? ctx?.dayFirst ?? false, year);
  }
  return parseDayMonthDate(dm[0], year);
}

// Day-first (DD/MM) inference from the date-like tokens in a set of texts: any
// first component > 12 proves day-first; any second component > 12 proves
// month-first. Returns null when ambiguous (no >12 component seen).
function detectDayFirstFromTexts(texts: string[]): boolean | null {
  let firstGt12 = 0;
  let secondGt12 = 0;
  for (const t of texts) {
    const re = /\b(\d{1,2})[/-](\d{1,2})\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t)) !== null) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (a > 12 && b <= 12) firstGt12 += 1;
      else if (b > 12 && a <= 12) secondGt12 += 1;
    }
  }
  if (firstGt12 > 0 && secondGt12 === 0) return true;
  if (secondGt12 > 0 && firstGt12 === 0) return false;
  return null;
}

function cellMoney(cell: string): { value: number; negative: boolean } | null {
  if (!cell) return null;
  const moneys = extractMoneyValues(cell);
  if (moneys.length === 0) return null;
  const last = moneys[moneys.length - 1];
  const trailing = cell.slice(cell.lastIndexOf(last.raw) + last.raw.length);
  const negative = last.value < 0 || /\bcr\b/i.test(trailing);
  return { value: Math.abs(last.value), negative };
}

/**
 * Resolve credit-card opening/closing so we never silently use New Balance for
 * BOTH. New Balance (closing) is the reliable anchor; Previous Balance (opening) is
 * frequently mislabeled when the statement prints a horizontal summary row, so the
 * detected opening can wrongly equal closing. When opening is missing or equals
 * closing, derive Previous Balance from the AUTHORITATIVE printed totals
 * (previous = new - debits + credits). If it cannot be confidently distinguished,
 * leave opening null rather than produce a same-balance false pass.
 */
export function resolveCreditCardOpenClose(
  opening: number | null,
  closing: number | null,
  summary: { credits: number | null; debits: number | null },
): { opening: number | null; closing: number | null } {
  const cr = summary.credits;
  const db = summary.debits;
  const haveTotals = typeof cr === "number" && typeof db === "number";
  const sameAsClosing =
    typeof opening === "number" && typeof closing === "number" && Math.abs(opening - closing) < 0.01;
  if (typeof closing === "number" && haveTotals && (opening === null || sameAsClosing)) {
    // Authoritative previous balance: previous = new - debits + credits. This may
    // equal closing (a net-zero period, which is legitimate) or differ (the
    // mislabel case); either way the derived value is correct. When there are no
    // printed totals to derive from we leave the detected values as-is: a
    // same-balance near-empty false candidate is downgraded by candidate scoring
    // (see scoreCandidate), not silently rewritten here.
    const implied = Math.round((closing - (db as number) + (cr as number)) * 100) / 100;
    return { opening: implied, closing };
  }
  return { opening, closing };
}

// ----- 5/6. Row reconstruction + summary separation per table region -----

type ColIndex = Partial<Record<ColumnMeaning, number>>;

function buildColIndex(cols: TableColumn[]): ColIndex {
  const idx: ColIndex = {};
  cols.forEach((c, i) => {
    if (idx[c.meaning] === undefined) idx[c.meaning] = i;
  });
  return idx;
}

let coordRowCounter = 0;
function newCoordRow(): TransactionRow {
  coordRowCounter += 1;
  return {
    id: `coord-${coordRowCounter}-${Math.random().toString(36).slice(2, 7)}`,
    date: "",
    description: "",
    debit: null,
    credit: null,
    balance: null,
    category: "",
    confidence: 0.92,
  };
}

type Diag = {
  rowsBuilt: number;
  datelessRowsPromoted: number;
  wrappedDescriptionsJoined: number;
  fxDetailLinesAttached: number;
  summaryRowsIgnored: number;
  footerLegalRowsIgnored: number;
  /** Credit-card amount rows rejected for having no date context (summary/metadata). */
  rowsRejectedAsNonTx: number;
  /** Zero-amount itemized lines ignored (never a real transaction). */
  zeroAmountRowsIgnored: number;
};

/**
 * Reconstruct transaction rows for one table region. Direction is taken from the
 * COLUMN a value lands in (debit vs credit), or from sign/CR for single-amount
 * tables, with the running-balance delta as a tiebreaker — no keyword guessing
 * is needed because the layout tells us the meaning.
 */
function buildRegionRows(
  lines: VisualLine[],
  region: TableRegion,
  endIndex: number,
  year: number | undefined,
  diag: Diag,
  seedBalance: number | null,
  dateCtx: StatementDateContext | null,
  dayFirst: boolean,
): TransactionRow[] {
  const cols = region.columns;
  const ci = buildColIndex(cols);
  const rows: TransactionRow[] = [];
  let carriedDate: string | null = null;
  // Seed with the opening balance so a single-amount row's direction can be
  // decided from the running-balance delta starting at the very first row.
  let lastBalance: number | null = seedBalance;
  let pendingDesc: string[] = [];
  let pendingDate: string | null = null;
  let fxSeen = false;

  const cell = (cells: string[], m: ColumnMeaning): string =>
    ci[m] !== undefined ? cells[ci[m]!] : "";

  // Set a row's Description and (internal) category. When the layout has a SEPARATE
  // category column, its value is already split out by x-position — capture it into
  // the model (preserved internally; excluded from the default table + export).
  // When there is NO category column, only for credit-card tables strip a
  // DISTINCTIVE trailing spend-category phrase that leaked into the description
  // (structure-aware first; conservative string strip as a fallback). Real merchant
  // descriptions are left untouched.
  const setDescriptionAndCategory = (
    row: TransactionRow,
    rawDescription: string,
    categoryCell: string,
  ) => {
    const desc = cleanDescription(rawDescription);
    if (categoryCell) {
      row.description = desc;
      row.category = categoryCell;
      return;
    }
    if (region.statementKind === "credit-card") {
      const split = splitTrailingSpendCategory(desc);
      row.description = split.description;
      if (split.category) row.category = split.category;
      return;
    }
    row.description = desc;
  };

  const finalizePending = (amountInfo: { value: number; negative: boolean } | null) => {
    if (pendingDesc.length === 0 && !pendingDate) return;
    // A zero amount is not a transaction (e.g. "Interest Charge on Cash Advances $0.00").
    if (amountInfo && Math.abs(amountInfo.value) < 0.005) {
      diag.zeroAmountRowsIgnored += 1;
      pendingDesc = [];
      pendingDate = null;
      return;
    }
    if (!amountInfo) {
      pendingDesc = [];
      pendingDate = null;
      return;
    }
    const row = newCoordRow();
    row.date = pendingDate ?? carriedDate ?? "";
    setDescriptionAndCategory(row, pendingDesc.join(" "), "");
    // Single-amount table: sign/CR decides direction (CC charge default = debit);
    // an unsigned payment/credit/refund description is treated as a credit.
    if (region.statementKind === "credit-card") {
      if (amountInfo.negative || ccDescriptionIsCredit(row.description)) row.credit = amountInfo.value;
      else row.debit = amountInfo.value;
    } else {
      row.debit = amountInfo.value; // bank single-amount fallback (rare)
    }
    if (!row.date) row.confidence -= 0.1;
    if (!row.description) row.confidence -= 0.2;
    rows.push(row);
    diag.rowsBuilt += 1;
    if (fxSeen) diag.fxDetailLinesAttached += 1;
    pendingDesc = [];
    pendingDate = null;
    fxSeen = false;
  };

  for (let i = region.headerIndex + 1; i < endIndex; i += 1) {
    const line = lines[i];
    const text = line.text;

    if (COORD_STOP_RE.test(text)) {
      diag.footerLegalRowsIgnored += 1;
      break;
    }
    if (COORD_IGNORE_RE.test(text) || detectBalanceLine(text)) {
      diag.summaryRowsIgnored += 1;
      finalizePending(null);
      continue;
    }

    const cells = assignCells(line, cols);
    const dateRaw = cell(cells, "date");
    const dateVal = cellDate(dateRaw, year, dateCtx, dayFirst);
    const descCell = cell(cells, "description");
    const isCcRegion = region.statementKind === "credit-card";

    // Collect the column-resolved money values.
    const debitInfo = ci.debit !== undefined ? cellMoney(cells[ci.debit]) : null;
    const creditInfo = ci.credit !== undefined ? cellMoney(cells[ci.credit]) : null;
    const amountInfo = ci.amount !== undefined ? cellMoney(cells[ci.amount]) : null;
    const balanceInfo = ci.balance !== undefined ? cellMoney(cells[ci.balance]) : null;
    const hasAmount = Boolean(debitInfo || creditInfo || amountInfo);
    const hasAnyMoney = extractMoneyValues(text).length > 0;

    // FX / reference sub-lines never create rows; FX may carry the row's amount.
    if (!hasAmount && isFxDetail(text)) {
      fxSeen = true;
      continue;
    }
    if (!hasAmount && isReferenceText(text)) continue;

    // A dateless line that carries money but NOT in a money column is a
    // misaligned page-statistics / summary row (e.g. "Credits 7  26,111.25"),
    // never a transaction and never a wrapped description.
    if (!hasAmount && hasAnyMoney && pendingDesc.length === 0) {
      diag.summaryRowsIgnored += 1;
      continue;
    }

    if (hasAmount) {
      // Over-capture guard (credit-card only): a real CC transaction always has
      // its own transaction date, or completes a pending dated merchant. An amount
      // with NO date context on a CC table is statement metadata / a summary box
      // figure (e.g. "Total account balance", calculation rows) that aligned into
      // the amount column — never a transaction. Bank tables legitimately carry
      // forward a date across continuation rows, so this only applies to CC.
      if (isCcRegion && !dateVal && pendingDate === null && pendingDesc.length === 0) {
        diag.rowsRejectedAsNonTx += 1;
        fxSeen = false;
        continue;
      }

      // A transaction row (its amount is on this visual line, in a money column).
      const row = newCoordRow();
      // Bank tables carry the date forward across continuation rows; CC tables do
      // not (each transaction prints its own date or completes a pending merchant).
      const effDate = dateVal ?? pendingDate ?? (isCcRegion ? "" : carriedDate ?? "");
      if (dateVal) carriedDate = dateVal;
      if (!dateVal && (descCell || pendingDesc.length)) diag.datelessRowsPromoted += 1;
      row.date = effDate;
      const descParts = [...pendingDesc, descCell].filter(Boolean);
      setDescriptionAndCategory(row, descParts.join(" "), cell(cells, "category"));
      pendingDesc = [];
      pendingDate = null;

      if (region.statementKind === "bank-account" && (debitInfo || creditInfo)) {
        if (debitInfo) row.debit = debitInfo.value;
        if (creditInfo) row.credit = creditInfo.value;
      } else if (amountInfo) {
        // Single amount column: sign / CR sets direction; for a bank table use
        // the running-balance delta when available.
        let credit = amountInfo.negative;
        if (region.statementKind === "bank-account" && balanceInfo && lastBalance !== null) {
          credit = balanceInfo.value > lastBalance;
        }
        // Credit-card: an UNSIGNED amount on a payment/credit/refund row is a credit.
        if (!credit && isCcRegion && ccDescriptionIsCredit(row.description)) credit = true;
        if (credit) row.credit = amountInfo.value;
        else row.debit = amountInfo.value;
      } else if (debitInfo) {
        row.debit = debitInfo.value;
      } else if (creditInfo) {
        row.credit = creditInfo.value;
      }

      // A zero-amount line is not a transaction (e.g. an itemized "$0.00" fee or
      // interest line). Skip it: it contributes nothing and would otherwise show as
      // a no-amount row. The running balance, if any, is still carried.
      const rowMoney = Math.max(Math.abs(row.debit ?? 0), Math.abs(row.credit ?? 0));
      if (rowMoney < 0.005) {
        if (balanceInfo) lastBalance = balanceInfo.value;
        diag.zeroAmountRowsIgnored += 1;
        fxSeen = false;
        continue;
      }

      if (balanceInfo) {
        row.balance = balanceInfo.value;
        lastBalance = balanceInfo.value;
      }
      if (!row.date) row.confidence -= 0.1;
      if (!row.description) row.confidence -= 0.2;
      if (fxSeen) {
        diag.fxDetailLinesAttached += 1;
        fxSeen = false;
      }
      rows.push(row);
      diag.rowsBuilt += 1;
      continue;
    }

    // Dateless line with description but no amount: a wrapped description (joins
    // the row above) or the first line of a merchant whose amount is below it.
    if (descCell || dateVal) {
      if (pendingDesc.length === 0 && rows.length > 0 && !dateVal) {
        // Directly under a built row with no new date → wrapped continuation.
        rows[rows.length - 1].description = cleanDescription(
          `${rows[rows.length - 1].description} ${descCell}`,
        );
        diag.wrappedDescriptionsJoined += 1;
      } else {
        if (pendingDesc.length > 0) diag.wrappedDescriptionsJoined += 1;
        if (dateVal) pendingDate = dateVal;
        if (descCell) pendingDesc.push(descCell);
      }
    }
  }

  // A merchant whose CAD amount sat on its own line: complete it from the last
  // standalone amount we held (handled inline above); nothing trailing remains.
  return rows;
}

/** Where does a region end? At the next header, a hard stop, or end of lines. */
function regionEnd(lines: VisualLine[], regions: TableRegion[], idx: number): number {
  const start = regions[idx].headerIndex;
  let end = lines.length;
  if (idx + 1 < regions.length) end = regions[idx + 1].headerIndex;
  for (let i = start + 1; i < end; i += 1) {
    if (COORD_STOP_RE.test(lines[i].text)) return i;
  }
  return end;
}

// ----- 7. Build coordinate-table candidates -----

/**
 * Parse all detected table regions into candidate results. Each candidate is a
 * full statement interpretation (rows + balances + summary) that the parser's
 * reconciliation scorer ranks against the text-parser candidates.
 */
/**
 * Build one candidate from a single region. `allowRunningClose` permits using the
 * last running balance as the bank closing only for a complete, sole table (one
 * region, or the headerless whole-block candidate) — never for a fragment.
 */
function buildRegionCandidate(
  lines: VisualLine[],
  region: TableRegion,
  end: number,
  year: number | undefined,
  tableCandidatesFound: number,
  allowRunningClose: boolean,
  headerless: boolean,
  dateCtx: StatementDateContext | null = null,
): CoordTableCandidate | null {
  const isCcRegion = region.statementKind === "credit-card";
  const winStart = Math.max(0, region.headerIndex - 10);
  const regionTexts = lines.slice(winStart, Math.max(winStart, end)).map((l) => l.text);
  // Credit-card previous/new balances are statement-global and unique, and may be
  // printed after an end-of-table marker (interest-rate chart) outside the row
  // window. Scan the whole document for them; bank balances stay region-scoped so
  // multi-account statements keep per-account anchors.
  const ccTexts = isCcRegion ? lines.map((l) => l.text) : regionTexts;
  const ccBalances = detectCreditCardBalances(ccTexts);
  const bankOpenClose = regionBankBalances(lines, Math.max(0, region.headerIndex), end);
  const ccSummary = detectCreditCardSummary(ccTexts);
  const bankSummary = detectBankSummary(regionTexts);
  const diag: Diag = {
    rowsBuilt: 0,
    datelessRowsPromoted: 0,
    wrappedDescriptionsJoined: 0,
    fxDetailLinesAttached: 0,
    summaryRowsIgnored: 0,
    footerLegalRowsIgnored: 0,
    rowsRejectedAsNonTx: 0,
    zeroAmountRowsIgnored: 0,
  };
  const isCc = region.statementKind === "credit-card";
  const seedBalance = isCc ? null : bankOpenClose.opening;
  // Day/month order: prefer the period context, else infer from the region's own
  // date tokens (a component > 12), else default to month-first (legacy behavior).
  const dayFirst = dateCtx?.dayFirst ?? detectDayFirstFromTexts(regionTexts) ?? false;
  const rows = buildRegionRows(lines, region, end, year, diag, seedBalance, dateCtx, dayFirst);
  if (rows.length === 0) return null;

  const summary = isCc
    ? ccSummary
    : { credits: bankSummary.credits, debits: bankSummary.debits };
  // Bank closing: prefer an explicit statement balance label. Only fall back to
  // the last running balance for a sole/complete table; for one of several
  // regions the last running balance is a mid-statement value and would let a
  // fragment trivially "reconcile" (opening + credits − debits == lastBalance
  // holds for any contiguous subset) and wrongly beat the complete text parse.
  const bankClosing = bankOpenClose.closing ?? (allowRunningClose ? lastRowBalance(rows) : null);
  const { opening, closing } = isCc
    ? resolveCreditCardOpenClose(ccBalances.opening, ccBalances.closing, ccSummary)
    : { opening: bankOpenClose.opening, closing: bankClosing };
  const columnOrder = region.columns.map((c) => c.meaning).join("|");

  return {
    statementKind: region.statementKind,
    rows,
    opening,
    closing,
    summary,
    columnOrder,
    headerColumns: region.columns.length,
    confidence: headerless ? Math.min(region.confidence, 0.45) : region.confidence,
    diagnostics: {
      coordinateAvailable: true,
      tableCandidatesFound,
      chosenTableType: region.statementKind,
      headerColumnsDetected: region.columns.length,
      columnOrder,
      rowsBuilt: diag.rowsBuilt,
      datelessRowsPromoted: diag.datelessRowsPromoted,
      wrappedDescriptionsJoined: diag.wrappedDescriptionsJoined,
      fxDetailLinesAttached: diag.fxDetailLinesAttached,
      summaryRowsIgnored: diag.summaryRowsIgnored,
      footerLegalRowsIgnored: diag.footerLegalRowsIgnored,
      finalBalanceDifference: null,
      stitched: false,
      regionsStitched: 1,
      ccRowsRejectedAsNonTx: diag.rowsRejectedAsNonTx,
      ccZeroAmountRowsIgnored: diag.zeroAmountRowsIgnored,
      ccOptionalColumnsIgnored: region.columns.filter((c) => OPTIONAL_MEANINGS.has(c.meaning)).length,
    },
  };
}

// ----- 8. Region stitching (combine continued/sectioned table regions) -----

export type StitchPlan = {
  /** Consecutive region indices grouped together (length 1 = not stitched). */
  groups: number[][];
  /** Multi-region groups (each yields one stitched candidate attempt). */
  stitchedCandidatesTried: number;
  regionsStitched: number;
  rejectedCount: number;
  rejectReasons: Record<string, number>;
  /** Adjacencies joined via relaxed (optional-column) compatibility. */
  relaxedCompatibilityUsed: number;
};

/** A stable, order-independent signature of a region's column meanings. */
function meaningSet(cols: TableColumn[]): string {
  return [...new Set(cols.map((c) => c.meaning))].sort().join(",");
}

// Columns that carry the reconciliation-relevant meaning. Optional columns
// (category / reference / postDate) may appear on one page but not another and
// must NOT block stitching of an otherwise-identical table.
const OPTIONAL_MEANINGS = new Set<ColumnMeaning>(["category", "postDate"]);

/** Do shared columns sit at similar x-centers (same physical layout)? */
function centersAlign(a: TableColumn[], b: TableColumn[], tol = 30): boolean {
  const mb = new Map(b.map((c) => [c.meaning, c.center] as const));
  for (const c of a) {
    const other = mb.get(c.meaning);
    if (other === undefined || Math.abs(other - c.center) > tol) return false;
  }
  return true;
}

/** Reconciliation-relevant value shape of a region's columns. */
function valueShape(cols: TableColumn[]): "amount" | "debit-credit" | "none" {
  const has = (m: ColumnMeaning) => cols.some((c) => c.meaning === m);
  if (has("amount")) return "amount";
  if (has("debit") || has("credit")) return "debit-credit";
  return "none";
}

/** Do the STABLE anchor columns (date, description) align across regions? */
function anchorCentersAlign(a: TableColumn[], b: TableColumn[], tol = 50): boolean {
  for (const m of ["date", "description"] as const) {
    const ca = a.find((c) => c.meaning === m)?.center;
    const cb = b.find((c) => c.meaning === m)?.center;
    if (ca === undefined || cb === undefined) continue;
    if (Math.abs(ca - cb) > tol) return false;
  }
  return true;
}

type StitchDecision = { reason: string | null; relaxed: boolean };

/**
 * Decide whether two consecutive regions can be stitched. Compatible when the
 * same kind, sequential pages, no legal/remittance/footer barrier between them,
 * and (bank) no fresh account opening between them. Columns may match either
 * STRICTLY (identical meanings at aligned x) or via RELAXED compatibility: the
 * core value shape and date/description anchors match while an OPTIONAL column
 * (category/reference/posting date) appears on only one page or shifts the
 * amount x — per-region rows are built independently, so this is safe.
 */
function stitchDecision(
  lines: VisualLine[],
  prev: TableRegion,
  prevEnd: number,
  next: TableRegion,
): StitchDecision {
  if (prev.statementKind !== next.statementKind) return { reason: "kind-mismatch", relaxed: false };

  const strictSame =
    meaningSet(prev.columns) === meaningSet(next.columns) &&
    centersAlign(prev.columns, next.columns);
  let relaxed = false;
  if (!strictSame) {
    const shape = valueShape(prev.columns);
    const sameShape = shape !== "none" && shape === valueShape(next.columns);
    const bothHaveDesc =
      prev.columns.some((c) => c.meaning === "description") &&
      next.columns.some((c) => c.meaning === "description");
    const sameDatePresence =
      prev.columns.some((c) => c.meaning === "date") ===
      next.columns.some((c) => c.meaning === "date");
    // Differences must be confined to optional columns only.
    const prevCore = meaningSet(prev.columns.filter((c) => !OPTIONAL_MEANINGS.has(c.meaning)));
    const nextCore = meaningSet(next.columns.filter((c) => !OPTIONAL_MEANINGS.has(c.meaning)));
    if (!sameShape || !bothHaveDesc || !sameDatePresence || prevCore !== nextCore) {
      return { reason: "columns-mismatch", relaxed: false };
    }
    if (!anchorCentersAlign(prev.columns, next.columns)) {
      return { reason: "centers-misaligned", relaxed: false };
    }
    relaxed = true;
  }

  if (next.page < prev.page || next.page - prev.page > 1) return { reason: "page-gap", relaxed };
  for (let i = prevEnd; i < next.headerIndex && i < lines.length; i += 1) {
    if (STITCH_BARRIER_RE.test(lines[i].text)) return { reason: "hard-stop", relaxed };
  }
  if (prev.statementKind === "bank-account") {
    const scanEnd = Math.min(next.headerIndex + 4, lines.length);
    for (let i = prevEnd; i < scanEnd; i += 1) {
      const t = lines[i].text;
      if (/\b(opening|beginning) balance\b/i.test(t) && !/balance forward/i.test(t)) {
        return { reason: "new-account", relaxed };
      }
    }
  }
  return { reason: null, relaxed };
}

/** Group consecutive compatible regions (sequential continuation/sections only). */
export function planStitch(
  lines: VisualLine[],
  regions: TableRegion[],
  ends: number[],
): StitchPlan {
  const groups: number[][] = [];
  const rejectReasons: Record<string, number> = {};
  let rejectedCount = 0;
  let relaxedCompatibilityUsed = 0;
  if (regions.length === 0) {
    return {
      groups,
      stitchedCandidatesTried: 0,
      regionsStitched: 0,
      rejectedCount: 0,
      rejectReasons,
      relaxedCompatibilityUsed: 0,
    };
  }
  let current = [0];
  for (let i = 1; i < regions.length; i += 1) {
    const decision = stitchDecision(lines, regions[i - 1], ends[i - 1], regions[i]);
    if (decision.reason === null) {
      if (decision.relaxed) relaxedCompatibilityUsed += 1;
      current.push(i);
    } else {
      rejectedCount += 1;
      rejectReasons[decision.reason] = (rejectReasons[decision.reason] ?? 0) + 1;
      groups.push(current);
      current = [i];
    }
  }
  groups.push(current);
  const multi = groups.filter((g) => g.length > 1);
  return {
    groups,
    stitchedCandidatesTried: multi.length,
    regionsStitched: multi.reduce((a, g) => a + g.length, 0),
    rejectedCount,
    rejectReasons,
    relaxedCompatibilityUsed,
  };
}

/**
 * Build one statement-level candidate from a group of compatible regions: rows
 * are concatenated in page order, opening/summary recomputed over the combined
 * span, closing taken from the LAST region's label (or its final running balance,
 * since a stitched table is complete). Competes normally; reconciliation decides.
 */
function buildStitchedCandidate(
  lines: VisualLine[],
  regions: TableRegion[],
  ends: number[],
  group: number[],
  regionCandidates: (CoordTableCandidate | null)[],
  tableCandidatesFound: number,
): CoordTableCandidate | null {
  if (group.length < 2) return null;
  const firstIdx = group[0];
  const lastIdx = group[group.length - 1];
  const first = regions[firstIdx];
  const last = regions[lastIdx];
  const isCc = first.statementKind === "credit-card";
  const rows = group.flatMap((idx) => regionCandidates[idx]!.rows);
  if (rows.length === 0) return null;

  const spanStart = Math.max(0, first.headerIndex - 10);
  const spanEnd = ends[lastIdx];
  const spanTexts = lines.slice(spanStart, spanEnd).map((l) => l.text);

  let opening: number | null;
  let closing: number | null;
  let summary: { credits: number | null; debits: number | null };
  if (isCc) {
    // A credit-card statement's previous/new balance is a single statement-level
    // figure printed once (often on a summary page outside any one region's
    // span). Scan the whole document so a stitched multi-page CC candidate can
    // recover them; they are unique labels, so widening is safe.
    const allTexts = lines.map((l) => l.text);
    const b = detectCreditCardBalances(allTexts);
    summary = detectCreditCardSummary(allTexts);
    const resolved = resolveCreditCardOpenClose(b.opening, b.closing, summary);
    opening = resolved.opening;
    closing = resolved.closing;
  } else {
    opening = regionBankBalances(lines, first.headerIndex, ends[firstIdx]).opening;
    const lastClose = regionBankBalances(lines, last.headerIndex, ends[lastIdx]).closing;
    closing = lastClose ?? lastRowBalance(rows);
    const bs = detectBankSummary(spanTexts);
    summary = { credits: bs.credits, debits: bs.debits };
  }

  const columnOrder = first.columns.map((c) => c.meaning).join("|");
  const sum = (pick: (d: CoordTableDiagnostics) => number) =>
    group.reduce((a, idx) => a + pick(regionCandidates[idx]!.diagnostics), 0);

  return {
    statementKind: first.statementKind,
    rows,
    opening,
    closing,
    summary,
    columnOrder,
    headerColumns: first.columns.length,
    confidence: Math.min(0.9, 0.5 + group.length * 0.1),
    diagnostics: {
      coordinateAvailable: true,
      tableCandidatesFound,
      chosenTableType: first.statementKind,
      headerColumnsDetected: first.columns.length,
      columnOrder,
      rowsBuilt: rows.length,
      datelessRowsPromoted: sum((d) => d.datelessRowsPromoted),
      wrappedDescriptionsJoined: sum((d) => d.wrappedDescriptionsJoined),
      fxDetailLinesAttached: sum((d) => d.fxDetailLinesAttached),
      summaryRowsIgnored: sum((d) => d.summaryRowsIgnored),
      footerLegalRowsIgnored: sum((d) => d.footerLegalRowsIgnored),
      finalBalanceDifference: null,
      stitched: true,
      regionsStitched: group.length,
      ccRowsRejectedAsNonTx: sum((d) => d.ccRowsRejectedAsNonTx),
      ccZeroAmountRowsIgnored: sum((d) => d.ccZeroAmountRowsIgnored),
      ccOptionalColumnsIgnored: group.reduce(
        (a, idx) => a + regions[idx].columns.filter((c) => OPTIONAL_MEANINGS.has(c.meaning)).length,
        0,
      ),
    },
  };
}

export function parseCoordinateTables(
  items: PdfTextItem[],
  year?: number,
): CoordTableCandidate[] {
  if (!items || items.length === 0) return [];
  const lines = groupVisualLines(items);
  if (lines.length === 0) return [];
  const regions = detectTableRegions(lines);

  // Detect the statement period context once (real years + day/month order) so bare
  // day/month transaction dates resolve to correct YYYY-MM-DD, including across a
  // December→January year boundary.
  const dateCtx = detectStatementDateContext(lines.map((l) => l.text).join("\n"));

  // No header anywhere: try ONE conservative headerless x-clustering candidate.
  // It still competes via reconciliation, so a wrong guess loses to the text
  // fallback. Header-based detection is always preferred when present.
  if (regions.length === 0) {
    const headerless = detectHeaderlessRegion(lines);
    if (!headerless) return [];
    const cand = buildRegionCandidate(lines, headerless.region, headerless.end, year, 1, true, true, dateCtx);
    return cand ? [cand] : [];
  }

  const ends = regions.map((_, r) => regionEnd(lines, regions, r));
  const regionCandidates = regions.map((region, r) =>
    buildRegionCandidate(lines, region, ends[r], year, regions.length, regions.length === 1, false, dateCtx),
  );

  // Per-region candidates are kept (useful as diagnostics + they still compete).
  const candidates: CoordTableCandidate[] = [];
  for (const c of regionCandidates) if (c) candidates.push(c);

  // Stitched candidates combine compatible consecutive regions into one
  // statement-level interpretation. They DO NOT replace region candidates and are
  // not preferred — reconciliation scoring still decides the winner.
  const plan = planStitch(lines, regions, ends);
  for (const group of plan.groups) {
    const valid = group.filter((idx) => regionCandidates[idx] !== null);
    if (valid.length < 2) continue;
    const stitched = buildStitchedCandidate(lines, regions, ends, valid, regionCandidates, regions.length);
    if (stitched) candidates.push(stitched);
  }
  return candidates;
}

function lastRowBalance(rows: TransactionRow[]): number | null {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (rows[i].balance !== null) return rows[i].balance;
  }
  return null;
}

/**
 * Bank opening/closing for one region: prefer balances printed INSIDE the region
 * (so each account in a multi-account statement keeps its own anchors); only
 * fall back to a nearby label just above the header when the region has none.
 */
function regionBankBalances(
  lines: VisualLine[],
  start: number,
  end: number,
  lookback = 8,
): { opening: number | null; closing: number | null } {
  let opening: number | null = null;
  let closing: number | null = null;
  for (let i = start; i < end; i += 1) {
    const b = detectBalanceLine(lines[i].text);
    if (!b) continue;
    if (b.kind === "opening" && opening === null) opening = b.value;
    else if (b.kind === "closing") closing = b.value;
  }
  if (opening === null) {
    for (let i = start - 1; i >= Math.max(0, start - lookback); i -= 1) {
      const b = detectBalanceLine(lines[i].text);
      if (b && b.kind === "opening") {
        opening = b.value;
        break;
      }
    }
  }
  return { opening, closing };
}
