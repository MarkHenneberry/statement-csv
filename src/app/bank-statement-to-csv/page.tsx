import type { Metadata } from "next";
import Link from "next/link";
import { Section, SectionHeading } from "@/components/Section";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { HowItWorks } from "@/components/HowItWorks";
import { FeatureCards } from "@/components/FeatureCards";
import { FAQSection } from "@/components/FAQSection";
import { CTASection } from "@/components/CTASection";
import { ButtonLink } from "@/components/Button";
import { JsonLd } from "@/components/JsonLd";
import { OutputColumnsExample } from "@/components/content/OutputColumnsExample";
import { RelatedPagesLinks } from "@/components/content/RelatedPagesLinks";
import { absoluteUrl } from "@/lib/site";
import { homeFaqs } from "@/lib/faq";
import { breadcrumbJsonLd, faqPageJsonLd } from "@/lib/structured-data";

const path = "/bank-statement-to-csv";

export const metadata: Metadata = {
  title: "Bank Statement to CSV & Excel Converter",
  description:
    "Convert bank and credit-card statement PDFs to clean CSV or Excel. Upload a PDF, review highlighted rows, and export balance-checked spreadsheets for bookkeeping and accounting.",
  alternates: { canonical: absoluteUrl(path) },
};

const crumbs = [
  { name: "Home", path: "/" },
  { name: "Bank statement to CSV", path },
];

export default function BankStatementToCsvPage() {
  return (
    <>
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
      <JsonLd data={faqPageJsonLd(homeFaqs)} />

      <Section>
        <Breadcrumbs crumbs={crumbs} />
        <div className="max-w-3xl">
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            Convert Bank Statements to CSV and Excel
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-slate-600">
            StatementCSV turns bank and credit-card statement PDFs into clean, spreadsheet-ready
            rows. Upload a statement, review the extracted transactions, and export a CSV or Excel
            file with Date, Description, Debit, Credit, Amount, and Balance. It uses parser-first
            extraction with guided AI verification, and balance-checks the result before you export.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <ButtonLink href="/upload">Convert a statement</ButtonLink>
            <ButtonLink href="/sample" variant="secondary">
              See sample export
            </ButtonLink>
          </div>
          <p className="mt-4 text-sm text-slate-500">
            No bank login. Balance checks before export.
          </p>
        </div>
      </Section>

      <Section muted>
        <SectionHeading
          title="Upload a PDF statement, get a CSV or Excel file"
          description="No software to install and no bank connection — you only upload a PDF you already have."
        />
        <div className="mt-12">
          <HowItWorks />
        </div>
      </Section>

      <Section>
        <SectionHeading
          title="Bank and credit-card statement support"
          description="StatementCSV is built for statement layouts, not generic PDFs, so it focuses on transaction rows."
        />
        <div className="mt-12">
          <FeatureCards
            items={[
              {
                title: "Chequing & savings",
                body: "Everyday account statements with dated debits, credits, transfers, fees, and running balances.",
              },
              {
                title: "Credit card statements",
                body: "Convert credit card statements to CSV with purchases, payments, fees, and interest in clean columns.",
              },
              {
                title: "Bank statement to spreadsheet",
                body: "Export to CSV for Excel, Google Sheets, or Numbers, or to an Excel (.xlsx) file directly.",
              },
            ]}
            columns={3}
          />
        </div>
        <div className="mx-auto mt-10 max-w-4xl">
          <OutputColumnsExample
            title="From PDF statement to clean rows"
            caption="Sample data — review and edit the rows before you export to CSV or Excel."
          />
        </div>
      </Section>

      <Section muted>
        <SectionHeading
          title="Balance-checked exports you can trust to review"
          description="Accuracy comes from review, not from forcing a balanced result."
        />
        <div className="mt-12">
          <FeatureCards
            items={[
              {
                title: "Balance-checked exports",
                body: "Extracted rows are checked against the statement's opening and closing balances where possible. A balance gap is never shown as a verified conversion.",
              },
              {
                title: "Parser-first extraction with guided AI verification",
                body: "A statement-specific parser reads the layout first; guided AI verification works from rendered statement evidence to structure harder layouts, and the result is re-checked.",
              },
              {
                title: "Review highlighted rows",
                body: "Uncertain rows are highlighted before export. If totals do not reconcile, you review and edit the rows instead of receiving a falsely balanced file.",
              },
            ]}
            columns={3}
          />
        </div>
      </Section>

      <Section>
        <div className="mx-auto max-w-3xl">
          <SectionHeading
            title="Built for bookkeeping and accounting workflows"
            centered
          />
          <p className="mt-6 text-center text-base leading-relaxed text-slate-600">
            A clean CSV is a practical starting point for bookkeepers, accountants, small business
            owners, freelancers, landlords, and finance or admin teams. Sort and filter by date or
            payee, total expenses for a period, and prepare the data for tools like QuickBooks, Xero,
            or Wave. StatementCSV produces a standard CSV you map to your accounting tool&apos;s import
            format — see the{" "}
            <Link href="/blog/import-bank-statements-quickbooks" className="font-medium text-brand-700 hover:underline">
              QuickBooks import workflow guide
            </Link>
            .
          </p>
        </div>
      </Section>

      <Section muted>
        <div className="mx-auto max-w-3xl">
          <SectionHeading title="Bank statement to CSV FAQ" centered />
          <div className="mt-10">
            <FAQSection items={homeFaqs} />
          </div>
        </div>
      </Section>

      <RelatedPagesLinks
        links={[
          { label: "Canadian bank statement to CSV", href: "/canadian-bank-statement-to-csv", description: "Built for common Canadian statement formats." },
          { label: "RBC statement to CSV", href: "/convert-rbc-bank-statement-to-csv", description: "Convert RBC bank and card PDFs." },
          { label: "How to convert a PDF to CSV", href: "/help/how-to-convert-bank-statement-pdf-to-csv", description: "Step-by-step help guide." },
          { label: "Import into QuickBooks", href: "/blog/import-bank-statements-quickbooks", description: "Prepare a CSV for QuickBooks." },
          { label: "PDF to Excel", href: "/pdf-bank-statement-to-excel", description: "Open the data in Excel." },
          { label: "Sample output", href: "/sample", description: "See the cleaned data first." },
        ]}
      />

      <CTASection
        title="Convert a bank statement now"
        description="Upload a PDF, review the highlighted rows, and download a clean CSV or Excel file."
      />
    </>
  );
}
