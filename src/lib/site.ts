export const siteConfig = {
  name: "StatementCSV",
  // Update this to the real production domain before launch.
  url: "https://statementcsv.ca",
  // Core positioning: Canadian-first, parser-first extraction with balance checks.
  tagline: "Convert Canadian bank statements to clean CSV and Excel.",
  description:
    "Convert bank and credit-card statement PDFs into clean CSV and Excel files. " +
    "StatementCSV uses parser-first extraction with guided AI verification and " +
    "balance checks before export. Built for common Canadian statement formats, including " +
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
      { label: "Bank Statement to CSV", href: "/bank-statement-to-csv" },
      { label: "Canadian Statements", href: "/canadian-bank-statement-to-csv" },
      { label: "PDF to CSV", href: "/pdf-bank-statement-to-csv" },
      { label: "PDF to Excel", href: "/pdf-bank-statement-to-excel" },
      { label: "Sample Output", href: "/sample" },
    ],
  },
  {
    title: "Guides",
    links: [
      { label: "How to convert PDF to CSV", href: "/help/how-to-convert-bank-statement-pdf-to-csv" },
      { label: "Import into QuickBooks", href: "/blog/import-bank-statements-quickbooks" },
      { label: "Compare converters", href: "/compare-bank-statement-converters" },
      { label: "Bank Statement Parser", href: "/bank-statement-parser" },
    ],
  },
  {
    title: "Banks",
    links: [
      { label: "RBC statement to CSV", href: "/convert-rbc-bank-statement-to-csv" },
      { label: "TD statement to CSV", href: "/convert-td-bank-statement-to-csv" },
      { label: "BMO statement to CSV", href: "/convert-bmo-bank-statement-to-csv" },
      { label: "CIBC statement to CSV", href: "/convert-cibc-bank-statement-to-csv" },
      { label: "Scotiabank statement to CSV", href: "/convert-scotiabank-statement-to-csv" },
      { label: "Credit unions (Canada)", href: "/convert-credit-union-statement-to-csv-canada" },
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
