"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { PlanKey } from "@/lib/billing/plans";

/**
 * Starts Stripe Checkout for a paid plan. Signed-out users are sent to sign up with
 * a plan hint; signed-in users POST to /api/stripe/checkout and are redirected to
 * Stripe. The button never sends a Stripe price id — only the plan key, validated
 * server-side.
 */
export function PlanCheckoutButton({
  planKey,
  label,
  className,
  containerClassName = "mt-6",
}: {
  planKey: PlanKey;
  label: string;
  className: string;
  containerClassName?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setError(null);
    if (!isSupabaseConfigured()) {
      router.push(`/signup?plan=${planKey}`);
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      router.push(`/login?plan=${planKey}`);
      return;
    }
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planKey }),
      });
      const out = (await res.json().catch(() => ({}))) as { url?: string };
      if (res.ok && out.url) {
        window.location.href = out.url;
        return;
      }
      setError("Could not start checkout. Please try again.");
    } catch {
      setError("Could not start checkout. Please try again.");
    }
    setBusy(false);
  }

  return (
    <div className={containerClassName}>
      <button type="button" onClick={onClick} disabled={busy} className={`${className} disabled:opacity-50`}>
        {busy ? "Starting…" : label}
      </button>
      {error ? <p className="mt-2 text-center text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
