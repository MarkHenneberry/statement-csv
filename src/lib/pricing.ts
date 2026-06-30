import type { PlanKey } from "./billing/plans.ts";

export type PricingTier = {
  pages: string;
  price: string;
  priceSuffix?: string;
  /** Billing plan key for checkout (Pro+ tiers map to distinct plans). */
  planKey?: PlanKey;
};

export type PricingPlan = {
  name: string;
  price: string;
  priceSuffix?: string;
  /** Monthly page-credit allowance, shown prominently on the card. */
  pages: string;
  description: string;
  features: string[];
  cta: { label: string; href: string };
  highlighted?: boolean;
  /** Optional badge text (e.g. "Best value"). */
  badge?: string;
  /** Billing plan key for checkout (omitted for multi-tier cards like Pro+). */
  planKey?: PlanKey;
  /** Volume tiers shown inside the card (Pro+). */
  tiers?: PricingTier[];
  /** Small note under the features (e.g. higher-volume contact line). */
  note?: string;
};

export const pricingHeadline = "Simple monthly page credits for statement PDFs";

export const pricingSubheadline =
  "Monthly page credits for bank and credit-card statement PDFs. Run a free preview first, then " +
  "choose a plan based on how many pages you convert each month. Every plan includes clean CSV and " +
  "Excel exports, parser-first extraction with guided AI verification, and balance-checked exports.";

// Free preview: try before paying. Rendered as a callout above the paid plans.
export const freePreview = {
  name: "Free preview",
  description:
    "Try before paying. Convert up to 6 pages every 12 hours to see how your statement " +
    "converts, with no account and no bank login required.",
  cta: { label: "Try free preview", href: "/upload" },
};

// Shared, honest feature set for every paid plan (page-credit positioning).
const PLAN_FEATURES = [
  "Monthly page credits for statement PDFs",
  "Clean CSV and Excel exports",
  "Parser-first extraction with guided AI verification",
  "Balance-checked exports",
  "Review highlighted rows before export",
  "No bank login required",
];

// Page-credit subscription plans. `planKey` links a card (or a Pro+ tier) to the
// billing plan used for Stripe checkout. Checkout requires a signed-in account;
// page-credit enforcement is not active yet.
export const pricingPlans: PricingPlan[] = [
  {
    name: "Minimum",
    price: "$10",
    priceSuffix: "/month",
    pages: "100 pages/month",
    description: "For occasional statement conversion.",
    features: PLAN_FEATURES,
    cta: { label: "Choose Minimum", href: "/upload" },
    planKey: "minimum",
  },
  {
    name: "Plus",
    price: "$25",
    priceSuffix: "/month",
    pages: "500 pages/month",
    description: "For small businesses, freelancers, landlords, and regular bookkeeping.",
    features: PLAN_FEATURES,
    cta: { label: "Choose Plus", href: "/upload" },
    highlighted: true,
    badge: "Best value",
    planKey: "plus",
  },
  {
    name: "Pro",
    price: "$40",
    priceSuffix: "/month",
    pages: "1,000 pages/month",
    description: "For bookkeepers, admin staff, and higher-volume users.",
    features: PLAN_FEATURES,
    cta: { label: "Choose Pro", href: "/upload" },
    planKey: "pro",
  },
  {
    name: "Pro+",
    price: "from $60",
    priceSuffix: "/month",
    pages: "2,000 or 3,000 pages/month",
    description: "For larger monthly workloads.",
    features: PLAN_FEATURES,
    cta: { label: "Choose Pro+", href: "/upload" },
    tiers: [
      { pages: "2,000 pages/month", price: "$60", priceSuffix: "/month", planKey: "pro_plus_2000" },
      { pages: "3,000 pages/month", price: "$80", priceSuffix: "/month", planKey: "pro_plus_3000" },
    ],
    note: "Need more than 3,000 pages/month? Contact us.",
  },
];

export const pricingFooter =
  "Prices are in CAD and based on the number of PDF pages processed. Page credits apply to digital " +
  "PDF statements. Scanned or image-based statements are not currently supported.";

// Plain-language page-credit rules, shown on the pricing page.
export const creditRules = [
  "Page credits are based on the number of PDF pages processed.",
  "Verified conversions use page credits.",
  "Review highlighted rows use page credits only if you export them.",
  "Could not extract statement does not use page credits.",
  "Page credits reset monthly.",
  "Extremely large or unusual files may be limited.",
];
