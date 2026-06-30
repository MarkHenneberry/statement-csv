"use client";

import { useState } from "react";
import {
  buildSafeDiagnosticSummary,
  formatDiagnosticSummary,
  type DiagnosticSummaryInput,
} from "@/lib/diagnostics-report";

// INTERNAL-TESTER-ONLY control. The parent (UploadFlow) renders this ONLY when the
// server-derived `internalTester` flag is true AND the conversion is flagged, so it
// is never shown to signed-out / free / paid users. It sends only the safe aggregate
// summary; the server route re-verifies tester status and re-sanitizes the payload.
export function DiagnosticReport({
  input,
  environmentLabel,
}: {
  input: DiagnosticSummaryInput;
  environmentLabel: string;
}) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [copied, setCopied] = useState(false);

  const summary = buildSafeDiagnosticSummary(input);

  async function handleSend() {
    if (state === "sending" || state === "sent") return;
    setState("sending");
    try {
      const res = await fetch("/api/diagnostics/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversionId: summary.conversionId, summary }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean } | null;
      setState(res.ok && data?.ok ? "sent" : "error");
    } catch {
      setState("error");
    }
  }

  async function handleCopy() {
    const text = formatDiagnosticSummary(summary, {
      testerEmail: "(this account)",
      timestamp: new Date().toISOString(),
      environmentLabel,
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — non-fatal; the send button still works.
    }
  }

  const btn =
    "inline-flex h-9 items-center justify-center rounded-lg px-3.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
          Internal
        </span>
        <button
          type="button"
          onClick={handleSend}
          disabled={state === "sending" || state === "sent"}
          className={`${btn} bg-slate-900 text-white hover:bg-slate-800`}
        >
          {state === "sending" ? "Sending…" : state === "sent" ? "Sent" : "Send diagnostic summary"}
        </button>
        <button
          type="button"
          onClick={handleCopy}
          className={`${btn} bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50`}
        >
          {copied ? "Copied" : "Copy diagnostic summary"}
        </button>
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-slate-500">
        Sends only safe conversion metadata. It does not send the PDF or transaction rows.
      </p>
      {state === "sent" ? (
        <p className="mt-1 text-xs font-medium text-emerald-700">Diagnostic summary sent.</p>
      ) : null}
      {state === "error" ? (
        <p className="mt-1 text-xs font-medium text-red-600">Could not send diagnostic summary.</p>
      ) : null}
    </div>
  );
}
