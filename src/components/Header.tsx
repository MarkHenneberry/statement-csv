"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Container } from "@/components/Container";
import { BrandMark } from "@/components/BrandMark";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { HeaderCreditPill, type PreviewStatus } from "@/components/HeaderCreditPill";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { primaryNav } from "@/lib/site";
import { QUOTA_UPDATED_EVENT } from "@/lib/client-events";

const navLinkClass = "text-sm font-medium text-slate-600 transition hover:text-slate-900";

// Compact header CTA — deliberately not the full Button system (which scales up to
// text-base / extra padding at sm+ and is too wide here). Same destination as before.
const ctaClass =
  "inline-flex h-9 shrink-0 items-center justify-center rounded-lg bg-brand-600 px-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600";

export function Header() {
  const [open, setOpen] = useState(false);
  // Cosmetic signed-in indicator only. Detected client-side so marketing pages stay
  // static; protected pages/data are gated server-side with validated auth.
  const [authed, setAuthed] = useState(false);
  // Server-derived page-credit / free-preview status for the compact pill. Null until
  // loaded (and on any error) so the pill stays hidden rather than showing wrong data.
  const [status, setStatus] = useState<PreviewStatus | null>(null);

  const refreshStatus = useCallback(() => {
    // Authoritative, never-cached server status. We re-read rather than trust any
    // client-provided count, so the pill is always in sync with enforcement.
    fetch("/api/preview-status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: PreviewStatus | null) => setStatus(d ?? null))
      .catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    refreshStatus();

    // Refetch when UploadFlow signals that preview usage may have changed, so the
    // pill updates after a conversion without a full page reload.
    const onQuotaUpdated = () => refreshStatus();
    window.addEventListener(QUOTA_UPDATED_EVENT, onQuotaUpdated);

    if (!isSupabaseConfigured()) {
      return () => window.removeEventListener(QUOTA_UPDATED_EVENT, onQuotaUpdated);
    }
    const supabase = createClient();
    let active = true;
    supabase.auth.getUser().then(({ data }) => {
      if (active) setAuthed(Boolean(data.user));
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthed(Boolean(session?.user));
      // Paid vs free-preview status can change with auth — refresh the pill.
      refreshStatus();
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
      window.removeEventListener(QUOTA_UPDATED_EVENT, onQuotaUpdated);
    };
  }, [refreshStatus]);

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <Container>
        <div className="flex h-16 items-center justify-between gap-3">
          <BrandMark imgClassName="h-10 w-auto" textClassName="text-lg" className="shrink-0" />

          {/* Full primary nav — wide screens only, so it can't collide at md/lg. */}
          <nav className="hidden items-center gap-6 xl:flex" aria-label="Primary">
            {primaryNav.map((item) => (
              <Link key={item.href} href={item.href} className={navLinkClass}>
                {item.label}
              </Link>
            ))}
          </nav>

          {/* Right cluster. Essential controls only at md–xl; hamburger below md. */}
          <div className="flex items-center gap-3">
            <HeaderCreditPill status={status} className="hidden md:inline-flex" />

            {/* Pricing is the one essential nav link kept inline on tablet widths
                (the full nav above already includes it at xl). */}
            <Link href="/pricing" className={`hidden md:inline xl:hidden ${navLinkClass}`}>
              Pricing
            </Link>

            <div className="hidden items-center gap-4 md:flex">
              {authed ? (
                <>
                  <Link href="/account" className={navLinkClass}>
                    Account
                  </Link>
                  <SignOutButton className={navLinkClass} />
                </>
              ) : (
                <Link href="/login" className={navLinkClass}>
                  Sign in
                </Link>
              )}
              <Link href="/upload" className={ctaClass}>
                Convert
              </Link>
            </div>

            <button
              type="button"
              className="inline-flex items-center justify-center rounded-md p-2 text-slate-700 md:hidden"
              aria-label="Toggle menu"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                {open ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
                )}
              </svg>
            </button>
          </div>
        </div>
      </Container>

      {open ? (
        <div className="border-t border-slate-200 md:hidden">
          <Container className="py-4">
            <nav className="flex flex-col gap-3" aria-label="Mobile">
              {/* Credit / preview status lives inside the menu on mobile. */}
              <HeaderCreditPill status={status} className="self-start" />

              {primaryNav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-md px-2 py-2 text-base font-medium text-slate-700 hover:bg-slate-50"
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </Link>
              ))}
              {authed ? (
                <>
                  <Link
                    href="/account"
                    className="rounded-md px-2 py-2 text-base font-medium text-slate-700 hover:bg-slate-50"
                    onClick={() => setOpen(false)}
                  >
                    Account
                  </Link>
                  <SignOutButton className="rounded-md px-2 py-2 text-left text-base font-medium text-slate-700 hover:bg-slate-50" />
                </>
              ) : (
                <Link
                  href="/login"
                  className="rounded-md px-2 py-2 text-base font-medium text-slate-700 hover:bg-slate-50"
                  onClick={() => setOpen(false)}
                >
                  Sign in
                </Link>
              )}
              <Link
                href="/upload"
                className={`${ctaClass} mt-2 h-11 w-full`}
                onClick={() => setOpen(false)}
              >
                Convert a statement
              </Link>
            </nav>
          </Container>
        </div>
      ) : null}
    </header>
  );
}
