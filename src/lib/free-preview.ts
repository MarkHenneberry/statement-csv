// Free-preview limits and copy constants.
//
// These define the FREE preview tier behavior. The page cap is enforced
// statelessly per request (see the parse-statement route). The "1 preview every
// 6 hours" interval and per-account AI quotas CANNOT be enforced without accounts
// / a datastore, so they are surfaced as messaging only for now.
//
// TODO(launch-blocker): enforce real server-side quota — preview interval
// (1 / 6h) and monthly page limits — once auth + a datastore + rate limiting
// exist. Until then this is honest free-preview messaging, NOT abuse protection.

/** Maximum pages processed for a free preview (enforced per request). */
export const FREE_PREVIEW_MAX_PAGES = 5;

/** Minimum hours between free previews (messaging only — needs accounts to enforce). */
export const FREE_PREVIEW_INTERVAL_HOURS = 6;

/**
 * Whether AI-assisted repair may run during a free preview. AI is always a
 * fallback (only when the parser result needs help); for free preview it is
 * additionally capped to the previewed pages. Per-account AI quotas are TODO.
 */
export const FREE_PREVIEW_AI_ASSIST_ALLOWED = true;

/** Notice shown when an uploaded statement exceeds the free preview page cap. */
export const FREE_PREVIEW_TRUNCATION_NOTICE = `Free preview covers the first ${FREE_PREVIEW_MAX_PAGES} pages. Only those pages were converted — upgrade to convert the full statement.`;

// A "money amount": $-prefixed or a number with thousands/decimals (1,234.56).
const MONEY_RE = /(?:\$\s*)?\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\$\s*\d+(?:\.\d{2})?|\d+\.\d{2}/;
// A day/month date token (matches the common statement date formats generically).
const DATE_RE =
  /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b|\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;

/**
 * A page carries MEANINGFUL statement content when it has at least two lines that
 * each contain both a date and a money amount — i.e. transaction rows. Blank
 * pages, marketing trailers, and contact/legal back-pages do not qualify. Generic
 * (no bank-specific text); operates on already-extracted page text and returns
 * only indexes/counts (no text is retained).
 */
export function detectMeaningfulPages(perPageText: string[]): number[] {
  const meaningful: number[] = [];
  perPageText.forEach((text, i) => {
    let txLines = 0;
    for (const line of text.split(/\r?\n/)) {
      if (DATE_RE.test(line) && MONEY_RE.test(line)) txLines += 1;
      if (txLines >= 2) break;
    }
    if (txLines >= 2) meaningful.push(i + 1); // 1-based page index
  });
  return meaningful;
}

export type PreviewLimitAnalysis = {
  previewLimited: boolean;
  meaningfulPagesDetected: number;
  skippedMeaningfulPagesCount: number;
  /** Safe label: why preview was (not) limited. No statement content. */
  previewLimitedReason: "no-truncation" | "skipped-meaningful-pages" | "skipped-pages-not-meaningful";
};

/**
 * Decide whether a conversion is genuinely preview-limited. The page cap alone is
 * NOT enough: if the skipped pages are blank/trailer/non-transaction pages, the
 * conversion covered all meaningful content and is not preview-limited.
 */
export function analyzePreviewLimit(
  perPageText: string[],
  pagesProcessed: number,
): PreviewLimitAnalysis {
  const meaningful = detectMeaningfulPages(perPageText);
  const skippedMeaningful = meaningful.filter((p) => p > pagesProcessed);
  if (perPageText.length <= pagesProcessed) {
    return {
      previewLimited: false,
      meaningfulPagesDetected: meaningful.length,
      skippedMeaningfulPagesCount: 0,
      previewLimitedReason: "no-truncation",
    };
  }
  return {
    previewLimited: skippedMeaningful.length > 0,
    meaningfulPagesDetected: meaningful.length,
    skippedMeaningfulPagesCount: skippedMeaningful.length,
    previewLimitedReason:
      skippedMeaningful.length > 0 ? "skipped-meaningful-pages" : "skipped-pages-not-meaningful",
  };
}
