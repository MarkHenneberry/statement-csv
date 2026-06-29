// Free-preview meaningful-page analysis + (deprecated) legacy limit constants.
//
// The REAL free-preview quota (6 pages / 12 hours / 5 attempts by default) is now
// enforced server-side via src/lib/billing/free-preview-quota.ts +
// evaluatePreviewAccess/getPreviewLimits in src/lib/billing/credits.ts. The
// constants below are LEGACY and no longer the source of truth — do not use them
// for user-facing copy (use getPreviewLimits()). They remain only so older imports
// don't break; detectMeaningfulPages/analyzePreviewLimit below are still used.

/** @deprecated Legacy per-request cap. Real limit: getPreviewLimits().pageLimit. */
export const FREE_PREVIEW_MAX_PAGES = 5;

/** @deprecated Legacy interval. Real window: getPreviewLimits().windowHours. */
export const FREE_PREVIEW_INTERVAL_HOURS = 6;

/** @deprecated Legacy flag. AI eligibility is decided in src/lib/ai-assist.ts. */
export const FREE_PREVIEW_AI_ASSIST_ALLOWED = true;

/** @deprecated Legacy truncation notice (preview is no longer page-truncated). */
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
