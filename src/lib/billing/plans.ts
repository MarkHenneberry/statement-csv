// Billing plan constants — the single source of truth for page-credit ALLOWANCES
// and plan keys. Public display strings (formatted prices, marketing copy) live in
// src/lib/pricing.ts; this file holds the machine values billing logic needs.
//
// NOTE: this is the data/logic foundation only. Nothing here enforces credits,
// charges cards, or talks to Stripe yet. Real Stripe price IDs are read from env
// vars (by NAME) in a later pass; no real IDs are hardcoded here.

export type PlanKey =
  | "free"
  | "minimum"
  | "plus"
  | "pro"
  | "pro_plus_2000"
  | "pro_plus_3000";

export type Plan = {
  key: PlanKey;
  /** Internal display name. Public pricing copy lives in src/lib/pricing.ts. */
  displayName: string;
  /** Monthly price in USD (0 for the free preview tier). */
  monthlyPriceUsd: number;
  /** Monthly page-credit allowance. Free relies on the separate preview path (0 credits). */
  monthlyPageAllowance: number;
  /** Env var NAME that will hold the real Stripe price ID in a later pass (no real IDs here). */
  stripePriceIdEnv: string | null;
  /** Whether this plan is a publicly selectable paid plan. */
  public: boolean;
};

export const PLANS: Record<PlanKey, Plan> = {
  free: {
    key: "free",
    displayName: "Free preview",
    monthlyPriceUsd: 0,
    // Free users have no monthly credit balance; the free preview is governed
    // separately by src/lib/free-preview.ts (per-preview page cap + interval).
    monthlyPageAllowance: 0,
    stripePriceIdEnv: null,
    public: false,
  },
  minimum: {
    key: "minimum",
    displayName: "Minimum",
    monthlyPriceUsd: 10,
    monthlyPageAllowance: 100,
    stripePriceIdEnv: "STRIPE_PRICE_ID_MINIMUM",
    public: true,
  },
  plus: {
    key: "plus",
    displayName: "Plus",
    monthlyPriceUsd: 25,
    monthlyPageAllowance: 500,
    stripePriceIdEnv: "STRIPE_PRICE_ID_PLUS",
    public: true,
  },
  pro: {
    key: "pro",
    displayName: "Pro",
    monthlyPriceUsd: 40,
    monthlyPageAllowance: 1000,
    stripePriceIdEnv: "STRIPE_PRICE_ID_PRO",
    public: true,
  },
  pro_plus_2000: {
    key: "pro_plus_2000",
    displayName: "Pro+ (2,000 pages)",
    monthlyPriceUsd: 60,
    monthlyPageAllowance: 2000,
    stripePriceIdEnv: "STRIPE_PRICE_ID_PRO_PLUS_2000",
    public: true,
  },
  pro_plus_3000: {
    key: "pro_plus_3000",
    displayName: "Pro+ (3,000 pages)",
    monthlyPriceUsd: 80,
    monthlyPageAllowance: 3000,
    stripePriceIdEnv: "STRIPE_PRICE_ID_PRO_PLUS_3000",
    public: true,
  },
};

export const PLAN_KEYS = Object.keys(PLANS) as PlanKey[];

export function isPlanKey(value: string): value is PlanKey {
  return value in PLANS;
}

/** Monthly page allowance for a plan key. */
export function getPlanAllowance(planKey: PlanKey): number {
  return PLANS[planKey].monthlyPageAllowance;
}

/**
 * Resolve the real Stripe price ID for a plan from the environment (by the env var
 * NAME stored on the plan). Returns null until the env var is set in a later pass.
 */
export function getStripePriceId(
  planKey: PlanKey,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const name = PLANS[planKey].stripePriceIdEnv;
  if (!name) return null;
  return env[name] ?? null;
}
