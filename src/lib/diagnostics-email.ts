import "server-only";

// Minimal, optional email transport for the internal diagnostic summary. No new
// dependency: it POSTs to an HTTP email API (Resend) when configured, so it can be
// wired purely with env vars and swapped for another provider later. If it isn't
// configured, the route reports a safe "not configured" failure rather than pretending
// to send. It only ever transmits the SAFE text body it is handed (safe aggregates).
//
// Env:
//   DIAGNOSTIC_REPORT_EMAIL       — recipient (internal support inbox). Required to send.
//   DIAGNOSTIC_REPORT_FROM_EMAIL  — optional sender (defaults below); must be a sender
//                                   your provider is allowed to send from.
//   RESEND_API_KEY                — transport secret. Required to send.

export type DiagnosticEmailResult =
  | { ok: true }
  | { ok: false; reason: "not-configured" | "send-failed" };

export function isDiagnosticEmailConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.DIAGNOSTIC_REPORT_EMAIL && env.RESEND_API_KEY);
}

/**
 * Deliver the diagnostic summary text. Returns a safe result label only — never the
 * provider response body, status internals, or any secret.
 */
export async function sendDiagnosticEmail(
  subject: string,
  body: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DiagnosticEmailResult> {
  const to = env.DIAGNOSTIC_REPORT_EMAIL;
  const apiKey = env.RESEND_API_KEY;
  if (!to || !apiKey) return { ok: false, reason: "not-configured" };
  const from = env.DIAGNOSTIC_REPORT_FROM_EMAIL || "StatementCSV Diagnostics <diagnostics@statementcsv.ca>";

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, text: body }),
    });
    return res.ok ? { ok: true } : { ok: false, reason: "send-failed" };
  } catch {
    // Network/transport error — safe label only; no internals surfaced.
    return { ok: false, reason: "send-failed" };
  }
}
