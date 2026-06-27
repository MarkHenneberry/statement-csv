import type { Metadata } from "next";
import Link from "next/link";
import { Section, SectionHeading } from "@/components/Section";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FeatureCards } from "@/components/FeatureCards";
import { FAQSection } from "@/components/FAQSection";
import { CTASection } from "@/components/CTASection";
import { ButtonLink } from "@/components/Button";
import { JsonLd } from "@/components/JsonLd";
import { RelatedPagesLinks } from "@/components/content/RelatedPagesLinks";
import { absoluteUrl } from "@/lib/site";
import type { FaqItem } from "@/lib/faq";
import { breadcrumbJsonLd, faqPageJsonLd } from "@/lib/structured-data";

const path = "/canadian-bank-statement-to-csv";

export const metadata: Metadata = {
  title: "Canadian Bank Statement to CSV and Excel",
  description:
    "Convert Canadian bank and credit-card statement PDFs to CSV or Excel. Designed for common Canadian statement formats — chequing, savings, and credit cards — with balance-checked exports for bookkeeping.",
  alternates: { canonical: absoluteUrl(path) },
};

const crumbs = [
  { name: "Home", path: "/" },
  { name: "Canadian bank statement to CSV", path },
];

const faqs: FaqItem[] = [
  {
    question: "How do I convert a Canadian bank statement PDF to CSV?",
    answer:
      "Upload the PDF you downloaded from your bank, review the extracted transactions, and download a CSV or Excel file with Date, Description, Debit, Credit, Amount, and Balance. It works best with digital, text-based PDFs.",
  },
  {
    question: "Can I convert a Canadian credit card statement to CSV?",
    answer:
      "Yes. Credit-card statements convert into the same clean structure as chequing and savings statements, with purchases, payments, fees, and interest as separate rows you can review.",
  },
  {
    question: "Are credit union statements supported?",
    answer:
      "StatementCSV is designed for common Canadian bank and credit-union statement layouts. It works best with digital, text-based PDFs. We do not claim every institution or format, so anything uncertain is highlighted for review before export.",
  },
  {
    question: "How are Interac e-Transfer descriptions handled?",
    answer:
      "Canadian statements often include Interac e-Transfer lines with reference details. StatementCSV keeps the readable description and lets you review or tidy the row before export, so your CSV stays clean.",
  },
  {
    question: "Is StatementCSV affiliated with Canadian banks?",
    answer:
      "No. StatementCSV is an independent tool and is not affiliated with or endorsed by any bank or credit union. You upload a PDF you already have; there is no bank login.",
  },
];

export default function CanadianBankStatementToCsvPage() {
  return (
    <>
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
      <JsonLd data={faqPageJsonLd(faqs)} />

      <Section>
        <Breadcrumbs crumbs={crumbs} />
        <div className="max-w-3xl">
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            Canadian Bank Statement to CSV and Excel
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-slate-600">
            Convert Canadian bank and credit-card statement PDFs into clean CSV or Excel files.
            StatementCSV is designed for common Canadian statement formats — chequing, savings, and
            credit cards — using parser-first extraction with guided AI verification, and
            balance-checks the result before you export.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <ButtonLink href="/upload">Convert a statement</ButtonLink>
            <ButtonLink href="/sample" variant="secondary">
              See sample export
            </ButtonLink>
          </div>
          <p className="mt-4 text-sm text-slate-500">
            Independent tool — not affiliated with any bank. No bank login.
          </p>
        </div>
      </Section>

      <Section muted>
        <SectionHeading
          title="Designed for common Canadian statement formats"
          description="Built around the patterns Canadian statements use, not generic PDF tables."
        />
        <div className="mt-12">
          <FeatureCards
            items={[
              {
                title: "Chequing & savings",
                body: "Dated debits, credits, transfers, fees, and running balances from everyday Canadian accounts.",
              },
              {
                title: "Credit cards & credit unions",
                body: "Monthly card statements and common credit-union layouts, with purchases, payments, fees, and interest.",
              },
              {
                title: "Interac e-Transfers",
                body: "e-Transfer descriptions are kept readable; reference noise can be reviewed or cleaned before export.",
              },
            ]}
            columns={3}
          />
        </div>
      </Section>

      <Section>
        <div className="mx-auto max-w-3xl">
          <SectionHeading title="Who it is for" centered />
          <p className="mt-6 text-center text-base leading-relaxed text-slate-600">
            StatementCSV is useful for Canadian small businesses, bookkeepers, accountants,
            landlords, freelancers, and finance or admin teams who need statement data in a
            spreadsheet. Export to CSV or Excel for bookkeeping, reconciliation, and review, then
            prepare the data for tools like QuickBooks, Xero, or Wave.
          </p>
        </div>
      </Section>

      <Section muted>
        <SectionHeading
          title="Balance-checked, reviewable exports"
          description="A balance gap is never presented as a verified conversion."
        />
        <div className="mt-12">
          <FeatureCards
            items={[
              {
                title: "Balance-checked exports",
                body: "Extracted rows are compared against the statement's opening and closing balances where the statement lists them.",
              },
              {
                title: "Review highlighted rows",
                body: "Uncertain rows are highlighted so you can check, edit, or add a missing transaction before downloading.",
              },
              {
                title: "Clean CSV and Excel",
                body: "Consistent Date, Description, Debit, Credit, Amount, and Balance columns, ready for spreadsheets and bookkeeping.",
              },
            ]}
            columns={3}
          />
        </div>
      </Section>

      <RelatedPagesLinks
        heading="Convert statements by Canadian bank"
        description="Bank-specific guides for the most common Canadian statement formats."
        links={[
          { label: "RBC statement to CSV", href: "/convert-rbc-bank-statement-to-csv", description: "Chequing, savings, and RBC credit cards." },
          { label: "TD statement to CSV", href: "/convert-td-bank-statement-to-csv", description: "TD accounts and credit card statements." },
          { label: "BMO statement to CSV", href: "/convert-bmo-bank-statement-to-csv", description: "BMO accounts and Mastercard statements." },
          { label: "CIBC statement to CSV", href: "/convert-cibc-bank-statement-to-csv", description: "CIBC accounts and credit card statements." },
          { label: "Scotiabank statement to CSV", href: "/convert-scotiabank-statement-to-csv", description: "Scotiabank accounts and Visa statements." },
          { label: "Credit unions (Canada)", href: "/convert-credit-union-statement-to-csv-canada", description: "Common Canadian credit union layouts." },
        ]}
      />

      <Section>
        <div className="mx-auto max-w-3xl">
          <SectionHeading title="Canadian bank statement FAQ" centered />
          <div className="mt-10">
            <FAQSection items={faqs} />
          </div>
          <p className="mt-6 text-center text-sm text-slate-600">
            Banking with RBC? See the{" "}
            <Link href="/convert-rbc-bank-statement-to-csv" className="font-medium text-brand-700 hover:underline">
              RBC statement to CSV
            </Link>{" "}
            guide, or the general{" "}
            <Link href="/bank-statement-to-csv" className="font-medium text-brand-700 hover:underline">
              bank statement to CSV
            </Link>{" "}
            page.
          </p>
        </div>
      </Section>

      <RelatedPagesLinks
        muted
        links={[
          { label: "Bank statement to CSV", href: "/bank-statement-to-csv", description: "The main conversion page." },
          { label: "Compare converters", href: "/compare-bank-statement-converters", description: "What to look for in a converter." },
          { label: "How to convert a PDF to CSV", href: "/help/how-to-convert-bank-statement-pdf-to-csv", description: "Step-by-step help guide." },
          { label: "Import into QuickBooks", href: "/blog/import-bank-statements-quickbooks", description: "Prepare a CSV for QuickBooks." },
          { label: "PDF to Excel", href: "/pdf-bank-statement-to-excel", description: "Open the data in Excel." },
          { label: "Security", href: "/security", description: "How your statement data is handled." },
        ]}
      />

      <CTASection
        title="Convert a Canadian statement now"
        description="Upload a PDF, review the highlighted rows, and download a clean CSV or Excel file."
      />
    </>
  );
}
