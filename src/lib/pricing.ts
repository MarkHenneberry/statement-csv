import { FREE_PREVIEW_MAX_PAGES, FREE_PREVIEW_INTERVAL_HOURS } from "./free-preview.ts";

export type PricingPlan = {
  name: string;
  price: string;
  priceSuffix?: string;
  description: string;
  features: string[];
  cta: { label: string; href: string };
  highlighted?: boolean;
};

export const pricingHeadline = "Affordable statement conversion with balance checks";

export const pricingSubheadline =
  "Run a free preview first, then choose a monthly plan based on how many pages you convert. " +
  "Every plan includes CSV and Excel exports, balance checks, and AI-assisted repair when needed.";

// Page-based pricing. Pages are counted after upload (see pricingFooter). Every
// tier includes CSV + Excel export, balance checks, and AI-assisted repair when
// the parser needs help. Digital PDF statements only; no bank login.
export const pricingPlans: PricingPlan[] = [
  {
    name: "Free Preview",
    price: "$0",
    description: "See how your statement converts before you pay.",
    features: [
      `Preview up to ${FREE_PREVIEW_MAX_PAGES} pages`,
      `1 preview every ${FREE_PREVIEW_INTERVAL_HOURS} hours`,
      "CSV + Excel export for previewed rows",
      "Balance check included",
      "AI-assisted repair when needed, capped",
      "Digital PDFs only",
      "No bank login",
    ],
    cta: { label: "Try the free preview", href: "/upload" },
  },
  {
    name: "Starter",
    price: "$5",
    priceSuffix: "/month",
    description: "For occasional conversions.",
    features: [
      "50 pages/month",
      "CSV + Excel export",
      "Balance checks",
      "AI-assisted repair when needed",
      "Digital PDFs only",
      "No bank login",
    ],
    cta: { label: "Get Starter", href: "/upload" },
  },
  {
    name: "Plus",
    price: "$10",
    priceSuffix: "/month",
    description: "Good for taxes and small business cleanup.",
    features: [
      "150 pages/month",
      "CSV + Excel export",
      "Balance checks",
      "AI-assisted repair when needed",
      "Digital PDFs only",
      "No bank login",
    ],
    cta: { label: "Get Plus", href: "/upload" },
    highlighted: true,
  },
  {
    name: "Pro",
    price: "$20",
    priceSuffix: "/month",
    description: "Best for bookkeepers and regular use.",
    features: [
      "300 pages/month",
      "CSV + Excel export",
      "Balance checks",
      "AI-assisted repair when needed",
      "Digital PDFs only",
      "No bank login",
    ],
    cta: { label: "Get Pro", href: "/upload" },
  },
];

// TODO(launch-blocker): paid tiers require auth + payments + server-side page
// quota enforcement, none of which exist yet. Until then only the free preview
// is actually available; the paid cards describe intended plans.
export const pricingFooter =
  "Prices are in USD. Page limits apply to digital PDF statements. Scanned or image-based statements are not currently supported.";
