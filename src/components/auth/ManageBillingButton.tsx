"use client";

import { useState } from "react";

/** Opens the Stripe Billing Portal for the signed-in user (manage/cancel plan). */
export function ManageBillingButton({ className = "" }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const out = (await res.json().catch(() => ({}))) as { url?: string };
      if (res.ok && out.url) {
        window.location.href = out.url;
        return;
      }
      setError("Could not open billing. Please try again.");
    } catch {
      setError("Could not open billing. Please try again.");
    }
    setBusy(false);
  }

  return (
    <div>
      <button type="button" onClick={onClick} disabled={busy} className={className}>
        {busy ? "Opening…" : "Manage billing"}
      </button>
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
