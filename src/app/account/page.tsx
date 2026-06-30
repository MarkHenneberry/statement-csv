import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { ensureAppAccount } from "@/lib/billing/account";
import {
  summarizeAccountUsage,
  getPreviewLimits,
  isInternalTesterUser,
  getInternalTesterAllowance,
  effectiveMonthlyAllowance,
  effectiveRemainingPages,
} from "@/lib/billing/credits";
import { PLANS, type PlanKey } from "@/lib/billing/plans";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { ManageBillingButton } from "@/components/auth/ManageBillingButton";

export const metadata: Metadata = {
  title: "Account",
  robots: { index: false, follow: false },
};

// Reads validated server-side auth + DB; never prerendered.
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  free: "Free",
  active: "Active",
  past_due: "Past due",
  canceled: "Canceled",
  incomplete: "Incomplete",
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-100 py-2.5 last:border-0">
      <dt className="text-sm text-slate-600">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums text-slate-900">{value}</dd>
    </div>
  );
}

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");

  // Idempotent: ensures the app User + default free BillingAccount exist.
  const { account } = await ensureAppAccount(user);

  // Internal-tester mode (server-side, env-driven). Shows a high effective allowance
  // and a clear "Internal tester" plan label, and suppresses upgrade prompts. No DB
  // flag — purely derived from the validated email + env allowlist.
  const internalTester = isInternalTesterUser(user.email);
  const testerOpts = { internalTester, testerAllowance: internalTester ? getInternalTesterAllowance() : 0 };

  const usage = internalTester
    ? {
        monthlyPageAllowance: effectiveMonthlyAllowance(account, testerOpts),
        pagesUsedThisPeriod: account.pagesUsedThisPeriod,
        remaining: effectiveRemainingPages(account, testerOpts),
      }
    : summarizeAccountUsage(account);
  const planLabel = internalTester
    ? "Internal tester"
    : (PLANS[account.planKey as PlanKey] ?? PLANS.free).displayName;
  const periodEnd = account.currentPeriodEnd.toISOString().slice(0, 10);
  const statusLabel = internalTester ? "Internal tester" : STATUS_LABEL[account.status] ?? account.status;
  const { checkout } = await searchParams;
  // Testers never see upgrade prompts while under their internal allowance.
  const showPlansLink = !internalTester && (account.status === "free" || account.status === "canceled");

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-12 sm:py-16">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Account</h1>
        <SignOutButton className="text-sm font-medium text-slate-600 transition hover:text-slate-900" />
      </div>

      {checkout === "success" ? (
        <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Thanks! Your subscription is being activated. Plan details below update once payment is
          confirmed (this can take a moment).
        </p>
      ) : null}

      <div className="mt-6 rounded-xl border border-slate-200 bg-surface p-6 shadow-card">
        <dl>
          <Row label="Email" value={user.email} />
          <Row label="Current plan" value={planLabel} />
          <Row label="Subscription status" value={statusLabel} />
          <Row label="Pages used this period" value={String(usage.pagesUsedThisPeriod)} />
          <Row label="Pages remaining" value={String(usage.remaining)} />
          <Row label="Monthly page allowance" value={String(usage.monthlyPageAllowance)} />
          <Row label="Billing period ends" value={periodEnd} />
        </dl>

        <div className="mt-5 flex flex-wrap items-center gap-4">
          {account.stripeCustomerId ? (
            <ManageBillingButton className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800" />
          ) : null}
          {showPlansLink ? (
            <Link href="/pricing" className="text-sm font-medium text-brand-700 hover:underline">
              View plans
            </Link>
          ) : null}
        </div>
      </div>

      {internalTester ? (
        <p className="mt-4 rounded-xl border border-slate-200 bg-section px-4 py-3 text-sm leading-relaxed text-slate-600 shadow-card">
          You have an internal tester account with a high monthly page allowance, so you can use the
          converter without a paid subscription. Usage is still tracked: verified conversions use
          pages, review-highlighted conversions use pages only when you export them, and statements we
          can&rsquo;t read are never charged.
        </p>
      ) : account.monthlyPageAllowance > 0 ? (
        <p className="mt-4 rounded-xl border border-slate-200 bg-section px-4 py-3 text-sm leading-relaxed text-slate-600 shadow-card">
          Each page of a converted statement uses one page credit. Verified conversions are charged
          when they complete; review-highlighted conversions are only charged if you export them, and
          statements we can&rsquo;t read are never charged. Credits reset at the start of each billing
          period.
        </p>
      ) : (
        <p className="mt-4 rounded-xl border border-slate-200 bg-section px-4 py-3 text-sm leading-relaxed text-slate-600 shadow-card">
          You&rsquo;re on the free preview: convert up to {getPreviewLimits().pageLimit} pages every{" "}
          {getPreviewLimits().windowHours} hours, no charge.{" "}
          <Link href="/pricing" className="font-medium text-brand-700 hover:underline">
            Choose a plan
          </Link>{" "}
          for a monthly page-credit allowance.
        </p>
      )}
    </div>
  );
}
