export const siteConfig = {
  name: "StatementCSV",
  // Update this to the real production domain before launch.
  url: "https://statementcsv.com",
  // Core positioning: affordable conversion with balance checks.
  tagline: "Affordable bank statement conversion with balance checks.",
  description:
    "Affordable bank statement conversion with balance checks. Turn PDF bank statements into clean CSV files for Excel, Google Sheets, bookkeeping, taxes, or budgeting. No bank login.",
};

export type NavLink = {
  label: string;
  href: string;
};

export const primaryNav: NavLink[] = [
  { label: "PDF to CSV", href: "/pdf-bank-statement-to-csv" },
  { label: "PDF to Excel", href: "/pdf-bank-statement-to-excel" },
  { label: "Pricing", href: "/pricing" },
  { label: "Security", href: "/security" },
  { label: "FAQ", href: "/faq" },
];

export const footerNav: { title: string; links: NavLink[] }[] = [
  {
    title: "Convert",
    links: [
      { label: "Bank Statement Converter", href: "/" },
      { label: "PDF to CSV", href: "/pdf-bank-statement-to-csv" },
      { label: "PDF to Excel", href: "/pdf-bank-statement-to-excel" },
      { label: "Bank Statement Parser", href: "/bank-statement-parser" },
      { label: "Sample Output", href: "/sample" },
    ],
  },
  {
    title: "Banks",
    links: [
      { label: "RBC statement to CSV", href: "/convert-rbc-bank-statement-to-csv" },
      { label: "TD statement to CSV", href: "/convert-td-bank-statement-to-csv" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "Pricing", href: "/pricing" },
      { label: "Privacy", href: "/privacy" },
      { label: "Security", href: "/security" },
      { label: "FAQ", href: "/faq" },
    ],
  },
];

/**
 * Helper to build absolute canonical URLs from a path.
 */
export function absoluteUrl(path = "/"): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${siteConfig.url}${normalized === "/" ? "" : normalized}`;
}
