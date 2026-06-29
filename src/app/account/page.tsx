import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { ensureAppAccount } from "@/lib/billing/account";
import { summarizeAccountUsage } from "@/lib/billing/credits";
import { PLANS, type PlanKey } from "@/lib/billing/plans";
import { SignOutButton } from "@/components/auth/SignOutButton";

export const metadata: Metadata = {
  title: "Account",
  robots: { index: false, follow: false },
};

// Reads validated server-side auth + DB; never prerendered.
export const dynamic = "force-dynamic";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-100 py-2.5 last:border-0">
      <dt className="text-sm text-slate-600">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums text-slate-900">{value}</dd>
    </div>
  );
}

export default async function AccountPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");

  // Idempotent: ensures the app User + default free BillingAccount exist.
  const { account } = await ensureAppAccount(user);
  const usage = summarizeAccountUsage(account);
  const plan = PLANS[account.planKey as PlanKey] ?? PLANS.free;
  const periodEnd = account.currentPeriodEnd.toISOString().slice(0, 10);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-12 sm:py-16">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Account</h1>
        <SignOutButton className="text-sm font-medium text-slate-600 transition hover:text-slate-900" />
      </div>

      <div className="mt-6 rounded-xl border border-slate-200 bg-surface p-6 shadow-card">
        <dl>
          <Row label="Email" value={user.email} />
          <Row label="Current plan" value={plan.displayName} />
          <Row label="Pages used this period" value={String(usage.pagesUsedThisPeriod)} />
          <Row label="Pages remaining" value={String(usage.remaining)} />
          <Row label="Monthly page allowance" value={String(usage.monthlyPageAllowance)} />
          <Row label="Billing period ends" value={periodEnd} />
        </dl>
      </div>

      <p className="mt-4 rounded-xl border border-slate-200 bg-section px-4 py-3 text-sm leading-relaxed text-slate-600 shadow-card">
        Paid plans with monthly page credits are coming soon. For now your account is on the
        free tier — run a free preview from the converter to see how your statements convert.
      </p>
    </div>
  );
}
