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

export const pricingHeadline = "Canadian statement conversion with balance checks";

export const pricingSubheadline =
  "Run a free preview first, then choose a monthly plan based on how many pages you convert. " +
  "Every plan includes CSV and Excel exports, parser-first extraction, guided AI verification " +
  "when needed, and balance checks before export.";

// Page-based pricing. Pages are counted after upload (see pricingFooter). Every
// tier includes CSV + Excel export, parser-first extraction, guided AI verification
// when the parser needs help, and balance checks. AI is available on every tier;
// it is not a paid-only feature. Optional AI category suggestions are a Plus/Pro
// extra. Digital PDF statements only; no bank login.
export const pricingPlans: PricingPlan[] = [
  {
    name: "Free Preview",
    price: "$0",
    description: "See how your statement converts before you pay.",
    features: [
      `Preview up to ${FREE_PREVIEW_MAX_PAGES} pages`,
      `1 preview every ${FREE_PREVIEW_INTERVAL_HOURS} hours`,
      "CSV + Excel export for previewed rows",
      "Parser-first extraction",
      "Guided AI verification when needed",
      "Balance check included",
      "Good for testing whether a statement can be converted",
    ],
    cta: { label: "Try the free preview", href: "/upload" },
  },
  {
    name: "Starter",
    price: "$5",
    priceSuffix: "/month",
    description: "For occasional full conversions.",
    features: [
      "50 pages/month",
      "Full statement conversions",
      "CSV + Excel export",
      "Parser-first extraction",
      "Guided AI verification when needed",
      "Balance checks before export",
    ],
    cta: { label: "Get Starter", href: "/upload" },
  },
  {
    name: "Plus",
    price: "$10",
    priceSuffix: "/month",
    description: "Good for regular bookkeeping cleanup.",
    features: [
      "150 pages/month",
      "CSV + Excel export",
      "Parser-first extraction",
      "Guided AI verification when needed",
      "Balance checks before export",
      "Optional AI category suggestions",
      "Editable categories before export",
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
      "Parser-first extraction",
      "Guided AI verification when needed",
      "Balance checks before export",
      "Optional AI category suggestions",
      "Batch-friendly workflow (planned)",
    ],
    cta: { label: "Get Pro", href: "/upload" },
  },
];

// TODO(launch-blocker): paid tiers require auth + payments + server-side page
// quota enforcement, none of which exist yet. Until then only the free preview
// is actually available; the paid cards describe intended plans. Optional AI
// category suggestions and batch workflow are planned, not yet live.
export const pricingFooter =
  "Prices are in USD. Page limits apply to digital PDF statements. Scanned or image-based statements are not currently supported. Optional AI category suggestions and batch tools are planned features.";

// Optional categories copy (categories are a Plus/Pro extra, separate from
// balance verification, AI-suggested, and easy to edit).
export const categoryFeatureHeadline = "Optional AI category suggestions";
export const categoryFeatureSubtext =
  "Get suggested categories for bookkeeping. Categories are AI-assisted, easy to edit, and separate from balance verification. Review and edit them before export.";
