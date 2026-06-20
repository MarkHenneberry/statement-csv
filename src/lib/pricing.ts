export type PricingPlan = {
  name: string;
  price: string;
  priceSuffix?: string;
  description: string;
  features: string[];
  cta: { label: string; href: string };
  highlighted?: boolean;
};

// Page-based pricing. Pages are counted after upload (see pricingNote).
export const pricingPlans: PricingPlan[] = [
  {
    name: "Free Preview",
    price: "$0",
    description: "See how your statement converts before you pay.",
    features: [
      "Preview up to 3 pages",
      "See how your statement converts",
      "No account required",
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
      "CSV export",
      "Balance checks",
      "No ads",
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
      "CSV export",
      "Balance checks",
      "No ads",
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
      "500 pages/month",
      "CSV + Excel export",
      "Balance checks",
      "No ads",
      "No bank login",
    ],
    cta: { label: "Get Pro", href: "/upload" },
  },
];

// TODO(launch-blocker): "Balance checks" above are stated as plan features but
// the validation pipeline does not exist yet. OCR support for scanned/image-heavy
// statements (referenced in pricingNote) is also not built. Both must be
// implemented and verified before these plans are sold.
export const pricingNote =
  "Pages are counted after upload. Digital PDF statements are included. Scanned or image-heavy statements may require OCR support and can take longer to process.";
