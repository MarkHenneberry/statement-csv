// Pure page-credit helpers. No DB, no UI, no side effects — just the rules that a
// later enforcement pass and Stripe webhook handlers will call. Fully unit-tested
// in scripts/billing-tests.mts.
//
// PAGE-CREDIT RULES (not enforced yet — see README.md):
//   - A "page" = one page of an uploaded statement PDF. Credits are based on pages
//     PROCESSED, not statements.
//   - Verified conversions charge their page count.
//   - Review-highlighted conversions charge their page count ONLY if exported.
//   - Could-not-extract (failed) conversions charge 0.
//   - Allowance resets at the start of each billing period.

import { getPlanAllowance, type PlanKey } from "./plans.ts";
import type {
  BillingAccount,
  ConversionStatus,
  SubscriptionStatus,
} from "./types.ts";

// Re-exported so callers can get an allowance straight from a plan key.
export { getPlanAllowance };

/** Minimal shape the period/usage helpers need (keeps them easy to unit test). */
type UsageAccount = Pick<BillingAccount, "monthlyPageAllowance" | "pagesUsedThisPeriod">;
type PeriodAccount = Pick<BillingAccount, "currentPeriodStart" | "currentPeriodEnd">;

/** Pages remaining in the current period (never negative). */
export function getRemainingPages(account: UsageAccount): number {
  return Math.max(0, account.monthlyPageAllowance - account.pagesUsedThisPeriod);
}

/**
 * Whether the account currently has enough remaining credits to process `pageCount`
 * pages. (The free preview path is separate and not gated by this.)
 */
export function canProcessPages(account: UsageAccount, pageCount: number): boolean {
  if (pageCount <= 0) return true;
  return pageCount <= getRemainingPages(account);
}

/**
 * Whether a conversion should consume page credits:
 *   - verified  -> always
 *   - review    -> only when the user exports the rows
 *   - failed    -> never
 */
export function shouldChargeCredits(
  status: ConversionStatus,
  exportRequested: boolean,
): boolean {
  switch (status) {
    case "verified":
      return true;
    case "review":
      return exportRequested === true;
    case "failed":
      return false;
    default:
      return false;
  }
}

/**
 * How many page credits a conversion should consume right now. Returns the full
 * page count when chargeable, otherwise 0. Negative/zero page counts clamp to 0.
 */
export function calculateChargeablePages(
  status: ConversionStatus,
  pageCount: number,
  exportRequested: boolean,
): number {
  if (!shouldChargeCredits(status, exportRequested)) return 0;
  return Math.max(0, Math.floor(pageCount));
}

// ----- Billing-period helpers (used by monthly reset + Stripe sync later) -----

/** True when `now` is at/after the account's current period end. */
export function isPeriodExpired(account: PeriodAccount, now: Date = new Date()): boolean {
  return now.getTime() >= account.currentPeriodEnd.getTime();
}

/** The period end one calendar month after `start` (UTC, clamped to month length). */
export function nextPeriodEnd(start: Date): Date {
  const d = new Date(start.getTime());
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + 1);
  // Guard month-length rollover (e.g. Jan 31 -> Feb): clamp to the new month's end.
  if (d.getUTCDate() < day) d.setUTCDate(0);
  return d;
}

/**
 * Compute the reset state for a new billing period: usage back to 0, allowance
 * refreshed from the plan, and a fresh period window starting at `now`. Pure — the
 * caller persists the result and writes a `monthly_reset` ledger entry.
 */
export function resetForNewPeriod(
  planKey: PlanKey,
  now: Date = new Date(),
): {
  monthlyPageAllowance: number;
  pagesUsedThisPeriod: number;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
} {
  return {
    monthlyPageAllowance: getPlanAllowance(planKey),
    pagesUsedThisPeriod: 0,
    currentPeriodStart: new Date(now.getTime()),
    currentPeriodEnd: nextPeriodEnd(now),
  };
}

/**
 * The default billing-account fields for a brand-new signed-in user: the free plan,
 * free status, zero allowance (the free preview is a separate path), zero usage, and
 * a fresh one-month period. Pure so it can be unit-tested and reused by the account
 * upsert. No Stripe IDs yet.
 */
export function defaultFreeAccountFields(now: Date = new Date()): {
  planKey: PlanKey;
  status: SubscriptionStatus;
  monthlyPageAllowance: number;
  pagesUsedThisPeriod: number;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
} {
  return {
    planKey: "free",
    status: "free",
    monthlyPageAllowance: getPlanAllowance("free"),
    pagesUsedThisPeriod: 0,
    currentPeriodStart: new Date(now.getTime()),
    currentPeriodEnd: nextPeriodEnd(now),
  };
}

/**
 * True when a subscription's billing period has moved forward (renewal), i.e. the
 * new period start is later than the stored one. Used to decide when to reset
 * `pagesUsedThisPeriod` to 0. Comparing period starts keeps webhook handling
 * idempotent: re-processing the same renewal event does not reset twice.
 */
export function periodAdvanced(prevStart: Date, newStart: Date): boolean {
  return newStart.getTime() > prevStart.getTime();
}

/**
 * Decide whether an account may process a PDF of `pageCount` pages. Pure (no auth,
 * no DB) so it is unit-testable and used by the upload route's pre-parser gate.
 *   - free / 0 allowance        -> PLAN_REQUIRED
 *   - paid but not enough left  -> INSUFFICIENT_PAGE_CREDITS (with remaining/required)
 *   - otherwise                 -> allowed
 */
export type UploadAccessDecision =
  | { allowed: true; remaining: number; required: number }
  | {
      allowed: false;
      code: "PLAN_REQUIRED" | "INSUFFICIENT_PAGE_CREDITS";
      remaining: number;
      required: number;
    };

export function evaluateUploadAccess(
  account: Pick<BillingAccount, "monthlyPageAllowance" | "pagesUsedThisPeriod">,
  pageCount: number,
): UploadAccessDecision {
  const remaining = getRemainingPages(account);
  const required = Math.max(0, Math.floor(pageCount));
  if (account.monthlyPageAllowance <= 0) {
    return { allowed: false, code: "PLAN_REQUIRED", remaining, required };
  }
  if (required > remaining) {
    return { allowed: false, code: "INSUFFICIENT_PAGE_CREDITS", remaining, required };
  }
  return { allowed: true, remaining, required };
}

/** Safe usage summary for the account page (allowance / used / remaining). */
export function summarizeAccountUsage(
  account: Pick<BillingAccount, "monthlyPageAllowance" | "pagesUsedThisPeriod">,
): { monthlyPageAllowance: number; pagesUsedThisPeriod: number; remaining: number } {
  return {
    monthlyPageAllowance: account.monthlyPageAllowance,
    pagesUsedThisPeriod: account.pagesUsedThisPeriod,
    remaining: getRemainingPages(account),
  };
}
