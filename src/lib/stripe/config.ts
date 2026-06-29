// Stripe plan/price/status mapping. Pure + env-injectable so it is unit-testable
// without the Stripe SDK or any network call. Price IDs are resolved from server
// env vars (by the names declared on each plan in src/lib/billing/plans.ts). This
// module holds NO secret keys — the secret key lives only in src/lib/stripe/server.ts.

import {
  PLANS,
  PLAN_KEYS,
  isPlanKey,
  getStripePriceId,
  type PlanKey,
} from "../billing/plans.ts";
import type { SubscriptionStatus } from "../billing/types.ts";

/** Publicly selectable PAID plans (excludes the free tier). */
export const PAID_PLAN_KEYS: PlanKey[] = PLAN_KEYS.filter(
  (k) => k !== "free" && PLANS[k].public,
);

export function isPaidPlanKey(value: unknown): value is PlanKey {
  return typeof value === "string" && isPlanKey(value) && value !== "free" && PLANS[value].public;
}

/** Resolve the Stripe price ID for a plan from server env (null until configured). */
export function priceIdForPlanKey(
  planKey: PlanKey,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return getStripePriceId(planKey, env);
}

/** Reverse map a Stripe price ID back to an internal plan key (for webhooks). */
export function planKeyForPriceId(
  priceId: string,
  env: NodeJS.ProcessEnv = process.env,
): PlanKey | null {
  for (const key of PAID_PLAN_KEYS) {
    if (getStripePriceId(key, env) === priceId) return key;
  }
  return null;
}

/** Map a Stripe subscription status to our internal SubscriptionStatus. */
export function stripeStatusToInternalStatus(stripeStatus: string): SubscriptionStatus {
  switch (stripeStatus) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    case "incomplete":
    case "paused":
      return "incomplete";
    default:
      return "incomplete";
  }
}
