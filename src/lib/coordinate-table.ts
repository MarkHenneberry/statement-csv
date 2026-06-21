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
  detectBalanceLine,
  detectCreditCardBalances,
  detectBankSummary,
  detectCreditCardSummary,
  cleanDescription,
  type StatementKind,
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

function matchHeaderMeaning(text: string): ColumnMeaning | null {
  const t = text.toLowerCase().replace(/\s+/g, " ").trim();
  for (const { meaning, re } of HEADER_PATTERNS) {
    if (re.test(t)) return meaning;
  }
  return null;
}

/**
 * Map a visual line's items into header columns, greedily merging up to 4
 * adjacent items so multi-word headers ("Transaction Date", "Cheque/Debit")
 * resolve. Returns the columns sorted left-to-right (one per distinct meaning).
 */
export function detectHeaderColumns(line: VisualLine): TableColumn[] {
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
      const m = matchHeaderMeaning(text);
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

/** Find every header row across the visual lines (one region per header). */
export function detectTableRegions(lines: VisualLine[]): TableRegion[] {
  const regions: TableRegion[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const cols = detectHeaderColumns(lines[i]);
    if (!isTableHeader(cols)) continue;
    // Confidence: share of the line's "words" that resolved to known columns,
    // blended with how many columns were found (more columns = clearer table).
    const confidence = Math.min(1, cols.length / 5 + 0.3);
    regions.push({
      headerIndex: i,
      page: lines[i].page,
      columns: cols,
      statementKind: kindFromColumns(cols),
      confidence,
    });
  }
  return regions;
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
  /credit limit|available credit|minimum payment|amount past due|payment due|payment slip|payment options|remittance|please pay|total payment enclosed|new balance|previous (?:account |statement )?balance|opening balance|closing balance|balance forward|beginning balance|ending balance|total (?:debits?|credits?|withdrawals?|deposits?|purchases?|charges?|payments?|fees?|interest)|amounts? (?:debited|credited)|number of items|no\.? of items|monthly (?:aver|min|average|minimum)|average (?:cr|dr|daily)?\.? ?bal|next statement|statement date|subtotal of monthly activity|total fees for this period|total interest for this period|interest charged|fees charged|page \d+ of \d+/i;

// Hard stop: legal/info/footer region — nothing after it on the page is a row.
const COORD_STOP_RE =
  /important (?:information about your account|account information)|how to (?:reach|contact) us|trade ?-?marks?|closing notice|protecting your/i;

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

function cellMoney(cell: string): { value: number; negative: boolean } | null {
  if (!cell) return null;
  const moneys = extractMoneyValues(cell);
  if (moneys.length === 0) return null;
  const last = moneys[moneys.length - 1];
  const trailing = cell.slice(cell.lastIndexOf(last.raw) + last.raw.length);
  const negative = last.value < 0 || /\bcr\b/i.test(trailing);
  return { value: Math.abs(last.value), negative };
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

  const finalizePending = (amountInfo: { value: number; negative: boolean } | null) => {
    if (pendingDesc.length === 0 && !pendingDate) return;
    if (!amountInfo) {
      pendingDesc = [];
      pendingDate = null;
      return;
    }
    const row = newCoordRow();
    row.date = pendingDate ?? carriedDate ?? "";
    row.description = cleanDescription(pendingDesc.join(" "));
    // Single-amount table: sign/CR decides direction (CC charge default = debit).
    if (region.statementKind === "credit-card") {
      if (amountInfo.negative) row.credit = amountInfo.value;
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
    const dateVal = dateRaw ? normalizeDate(dateRaw, year) : null;
    const descCell = cell(cells, "description");

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
      // A transaction row (its amount is on this visual line, in a money column).
      const row = newCoordRow();
      const effDate = dateVal ?? pendingDate ?? carriedDate ?? "";
      if (dateVal) carriedDate = dateVal;
      if (!dateVal && (descCell || pendingDesc.length)) diag.datelessRowsPromoted += 1;
      row.date = effDate;
      const descParts = [...pendingDesc, descCell].filter(Boolean);
      row.description = cleanDescription(descParts.join(" "));
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
        if (credit) row.credit = amountInfo.value;
        else row.debit = amountInfo.value;
      } else if (debitInfo) {
        row.debit = debitInfo.value;
      } else if (creditInfo) {
        row.credit = creditInfo.value;
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
export function parseCoordinateTables(
  items: PdfTextItem[],
  year?: number,
): CoordTableCandidate[] {
  if (!items || items.length === 0) return [];
  const lines = groupVisualLines(items);
  if (lines.length === 0) return [];
  const regions = detectTableRegions(lines);
  if (regions.length === 0) return [];

  const candidates: CoordTableCandidate[] = [];
  for (let r = 0; r < regions.length; r += 1) {
    const region = regions[r];
    const end = regionEnd(lines, regions, r);
    // Scope balance/summary detection to this account's region (plus a small
    // lookback for labels printed just above the header) so a multi-account
    // statement gives each section its own opening/closing, not the first.
    const winStart = Math.max(0, region.headerIndex - 10);
    const regionTexts = lines.slice(winStart, end).map((l) => l.text);
    const ccBalances = detectCreditCardBalances(regionTexts);
    const bankOpenClose = regionBankBalances(lines, region.headerIndex, end);
    const ccSummary = detectCreditCardSummary(regionTexts);
    const bankSummary = detectBankSummary(regionTexts);
    const diag: Diag = {
      rowsBuilt: 0,
      datelessRowsPromoted: 0,
      wrappedDescriptionsJoined: 0,
      fxDetailLinesAttached: 0,
      summaryRowsIgnored: 0,
      footerLegalRowsIgnored: 0,
    };
    const isCc = region.statementKind === "credit-card";
    const seedBalance = isCc ? null : bankOpenClose.opening;
    const rows = buildRegionRows(lines, region, end, year, diag, seedBalance);
    if (rows.length === 0) continue;

    const opening = isCc ? ccBalances.opening : bankOpenClose.opening;
    const runningClose = lastRowBalance(rows);
    const closing = isCc
      ? ccBalances.closing
      : (bankOpenClose.closing ?? runningClose);
    const summary = isCc
      ? ccSummary
      : { credits: bankSummary.credits, debits: bankSummary.debits };
    const columnOrder = region.columns.map((c) => c.meaning).join("|");

    candidates.push({
      statementKind: region.statementKind,
      rows,
      opening,
      closing,
      summary,
      columnOrder,
      headerColumns: region.columns.length,
      confidence: region.confidence,
      diagnostics: {
        coordinateAvailable: true,
        tableCandidatesFound: regions.length,
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
      },
    });
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
