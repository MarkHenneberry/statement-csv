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
