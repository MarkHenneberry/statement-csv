import { FREE_PREVIEW_MAX_PAGES } from "./free-preview.ts";

export type PricingTier = { pages: string; price: string; priceSuffix?: string };

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
    `Try before paying. Preview up to ${FREE_PREVIEW_MAX_PAGES} pages to see how your statement ` +
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

// TODO(launch-blocker): paid plans require accounts + payments + server-side page-
// credit enforcement, none of which exist yet. Until then only the free preview is
// actually available; the paid cards describe intended plans and their CTAs route to
// the free converter (no checkout is implied).
export const pricingPlans: PricingPlan[] = [
  {
    name: "Minimum",
    price: "$10",
    priceSuffix: "/month",
    pages: "100 pages/month",
    description: "For occasional statement conversion.",
    features: PLAN_FEATURES,
    cta: { label: "Start converting", href: "/upload" },
  },
  {
    name: "Plus",
    price: "$25",
    priceSuffix: "/month",
    pages: "500 pages/month",
    description: "For small businesses, freelancers, landlords, and regular bookkeeping.",
    features: PLAN_FEATURES,
    cta: { label: "Start converting", href: "/upload" },
    highlighted: true,
    badge: "Best value",
  },
  {
    name: "Pro",
    price: "$40",
    priceSuffix: "/month",
    pages: "1,000 pages/month",
    description: "For bookkeepers, admin staff, and higher-volume users.",
    features: PLAN_FEATURES,
    cta: { label: "Start converting", href: "/upload" },
  },
  {
    name: "Pro+",
    price: "from $60",
    priceSuffix: "/month",
    pages: "2,000 or 3,000 pages/month",
    description: "For larger monthly workloads.",
    features: PLAN_FEATURES,
    cta: { label: "Start converting", href: "/upload" },
    tiers: [
      { pages: "2,000 pages/month", price: "$60", priceSuffix: "/month" },
      { pages: "3,000 pages/month", price: "$80", priceSuffix: "/month" },
    ],
    note: "Need more than 3,000 pages/month? Contact us.",
  },
];

export const pricingFooter =
  "Prices are in USD and based on the number of PDF pages processed. Page credits apply to digital " +
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
