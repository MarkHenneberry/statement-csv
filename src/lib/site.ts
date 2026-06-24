export const siteConfig = {
  name: "StatementCSV",
  // Update this to the real production domain before launch.
  url: "https://statementcsv.com",
  // Core positioning: Canadian-first, parser-first extraction with balance checks.
  tagline: "Convert Canadian bank statements to clean CSV and Excel.",
  description:
    "Convert Canadian bank and credit card statements into clean CSV and Excel files. " +
    "StatementCSV uses parser-first extraction, guided AI verification when needed, and " +
    "balance checks before export. Built for Canadian statements first, including " +
    "Interac e-Transfers, credits, debits, fees, and card payments. No bank login.",
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
