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

const path = "/help/how-to-convert-bank-statement-pdf-to-csv";

export const metadata: Metadata = {
  title: "How to Convert a Bank Statement PDF to CSV",
  description:
    "A step-by-step guide to converting bank statement PDFs into CSV. Why PDFs are hard to work with, manual vs automated conversion, what balance checks mean, and what to do when rows are highlighted.",
  alternates: { canonical: absoluteUrl(path) },
};

const crumbs = [
  { name: "Home", path: "/" },
  { name: "How to convert a bank statement PDF to CSV", path },
];

const faqs: FaqItem[] = [
  {
    question: "Why won't my bank statement PDF convert properly?",
    answer:
      "Most issues come from scanned or image-only PDFs, where the transaction text is not selectable. StatementCSV works best with digital, text-based PDFs downloaded directly from your bank. If a layout is hard to read, uncertain rows are highlighted for review rather than guessed.",
  },
  {
    question: "How do I extract transactions from a bank statement PDF?",
    answer:
      "Upload the PDF to StatementCSV. It extracts the transaction rows — Date, Description, Debit, Credit, Amount, and Balance — using parser-first extraction with guided AI verification, then balance-checks the result. You review the rows and export a CSV or Excel file.",
  },
  {
    question: "What do balance checks mean?",
    answer:
      "A balance check compares the extracted transaction totals against the opening and closing balances printed on your statement. When they do not line up, the conversion is shown as needing review so you can find a missing or misread row. It is a sanity check, not a guarantee of perfect accuracy.",
  },
  {
    question: "What should I do if rows are highlighted?",
    answer:
      "Highlighted rows are the ones to check first. Open each one, compare it to the statement, and edit the cell, delete the row, or add a missing transaction. Once it looks right, export the CSV or Excel file.",
  },
];

export default function HowToConvertPdfToCsvPage() {
  return (
    <>
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
      <JsonLd data={faqPageJsonLd(faqs)} />

      <Section>
        <Breadcrumbs crumbs={crumbs} />
        <div className="max-w-3xl">
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            How to Convert a Bank Statement PDF to CSV
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-slate-600">
            Bank statement PDFs are built for reading, not for spreadsheets. This guide explains why
            they are hard to work with, how to convert one to CSV, what balance checks mean, and what
            to do when rows are highlighted for review.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <ButtonLink href="/upload">Convert a statement</ButtonLink>
            <ButtonLink href="/sample" variant="secondary">
              See sample export
            </ButtonLink>
          </div>
        </div>
      </Section>

      <Section muted>
        <div className="mx-auto max-w-3xl space-y-4 text-base leading-relaxed text-slate-600">
          <SectionHeading title="Why bank statement PDFs are hard to work with" />
          <p>
            A PDF preserves how a statement looks, not its structure. Columns are visual, not real,
            so copying transactions usually merges dates, descriptions, and amounts, splits multi-line
            descriptions across rows, and drops the sign on negative numbers. Multi-page statements
            repeat headers and totals that are easy to mistake for transactions.
          </p>
          <p>
            Scanned statements are harder still: they store an image of the page instead of selectable
            text, so the transactions cannot be read reliably. A digital PDF downloaded from your bank
            gives the most dependable result.
          </p>
        </div>
      </Section>

      <Section>
        <SectionHeading
          title="Manual copy/paste vs automated conversion"
          description="Both can work for a single page; only one scales to a year of statements."
        />
        <div className="mt-12">
          <FeatureCards
            items={[
              {
                title: "Manual copy/paste",
                body: "Fine for one short page, but columns break, descriptions split, and totals are easy to miscount. It does not scale across months.",
              },
              {
                title: "Generic PDF-to-Excel tools",
                body: "They try to pull tables from any document and often misread statement layouts, repeated headers, and split debit/credit columns.",
              },
              {
                title: "Statement-aware conversion",
                body: "StatementCSV focuses on transaction rows, rejoins wrapped descriptions, keeps debit and credit columns, and balance-checks the result.",
              },
            ]}
            columns={3}
          />
        </div>
      </Section>

      <Section muted>
        <SectionHeading title="How StatementCSV converts a PDF statement" />
        <div className="mt-8 mx-auto max-w-3xl space-y-4 text-base leading-relaxed text-slate-600">
          <p>
            Upload your PDF and StatementCSV extracts the transaction rows using parser-first
            extraction with guided AI verification that works from rendered statement evidence. It
            then compares the extracted totals against the statement&apos;s opening and closing balances.
          </p>
          <p>
            The result is shown for review with Date, Description, Debit, Credit, Amount, and Balance.
            A verified conversion means the totals reconciled; otherwise you are asked to review
            highlighted rows. A balance gap is never presented as verified, and StatementCSV does not
            invent balancing rows to force a match.
          </p>
        </div>
      </Section>

      <Section>
        <SectionHeading
          title="Export and review the CSV"
          description="Review first, then export — accuracy comes from checking the highlighted rows."
        />
        <div className="mt-12">
          <FeatureCards
            items={[
              {
                title: "Review highlighted rows",
                body: "Check the highlighted rows against the statement and edit, delete, or add transactions as needed.",
              },
              {
                title: "Export CSV or Excel",
                body: "Download a clean CSV for Excel, Google Sheets, or Numbers, or an Excel (.xlsx) file directly.",
              },
              {
                title: "Use it for bookkeeping",
                body: "Prepare the columns for tools like QuickBooks, Xero, or Wave. See the QuickBooks workflow guide for steps.",
              },
            ]}
            columns={3}
          />
        </div>
      </Section>

      <Section muted>
        <div className="mx-auto max-w-3xl">
          <SectionHeading title="PDF to CSV help FAQ" centered />
          <div className="mt-10">
            <FAQSection items={faqs} />
          </div>
          <p className="mt-6 text-center text-sm text-slate-600">
            Ready to try it? See the{" "}
            <Link href="/bank-statement-to-csv" className="font-medium text-brand-700 hover:underline">
              bank statement to CSV
            </Link>{" "}
            page or the{" "}
            <Link href="/blog/import-bank-statements-quickbooks" className="font-medium text-brand-700 hover:underline">
              QuickBooks import guide
            </Link>
            .
          </p>
        </div>
      </Section>

      <RelatedPagesLinks
        links={[
          { label: "Bank statement to CSV", href: "/bank-statement-to-csv", description: "The main conversion page." },
          { label: "Canadian bank statement to CSV", href: "/canadian-bank-statement-to-csv", description: "Common Canadian formats." },
          { label: "Import into QuickBooks", href: "/blog/import-bank-statements-quickbooks", description: "Prepare a CSV for QuickBooks." },
          { label: "PDF to Excel", href: "/pdf-bank-statement-to-excel", description: "Open the data in Excel." },
          { label: "Sample output", href: "/sample", description: "See the cleaned data first." },
          { label: "Security", href: "/security", description: "How your statement data is handled." },
        ]}
      />

      <CTASection
        title="Convert a bank statement PDF now"
        description="Upload a PDF, review the highlighted rows, and download a clean CSV or Excel file."
      />
    </>
  );
}
