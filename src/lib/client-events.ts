// Tiny shared client-event contract (no state library needed). UploadFlow dispatches
// this on the window after preview usage changes (a successful preview conversion or
// a PREVIEW_LIMIT block); the header's credit pill listens and refetches authoritative
// server status from /api/preview-status. No quota values travel on the event itself —
// listeners always re-read the server, never trust client-provided counts.

export const QUOTA_UPDATED_EVENT = "statementcsv:quota-updated";

/** Notify any listeners (e.g. the header pill) that quota state may have changed. */
export function dispatchQuotaUpdated(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(QUOTA_UPDATED_EVENT));
  }
}
