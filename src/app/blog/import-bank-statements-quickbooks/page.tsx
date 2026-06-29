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

const path = "/blog/import-bank-statements-quickbooks";

export const metadata: Metadata = {
  title: "Import Bank Statements into QuickBooks (CSV Workflow)",
  description:
    "Turn a PDF bank statement into a clean CSV you can prepare for QuickBooks import. Why PDFs don't import, converting to CSV/Excel, reviewing columns and totals, and common CSV issues.",
  alternates: { canonical: absoluteUrl(path) },
};

const crumbs = [
  { name: "Home", path: "/" },
  { name: "Import bank statements into QuickBooks", path },
];

const faqs: FaqItem[] = [
  {
    question: "Why won't my bank statement PDF import into QuickBooks?",
    answer:
      "QuickBooks imports structured data (such as CSV), not a PDF's visual layout. You first convert the PDF statement into a clean CSV, then prepare and import that file using QuickBooks' supported import workflow.",
  },
  {
    question: "Does StatementCSV import directly into QuickBooks?",
    answer:
      "No. StatementCSV is not an official QuickBooks integration or partner. It produces a standard, spreadsheet-ready CSV (or Excel file) that you map to QuickBooks' import format yourself.",
  },
  {
    question: "What format does QuickBooks need for a bank statement CSV?",
    answer:
      "QuickBooks accepts CSV with a date, a description, and amount columns (a single amount or separate debit/credit), and it has its own field mapping during import. StatementCSV gives you clean Date, Description, Debit, Credit, Amount, and Balance columns to map.",
  },
  {
    question: "Can I use the same CSV with Xero or Wave?",
    answer:
      "Yes. The CSV is a standard spreadsheet file, so you can prepare it for Xero, Wave, or other tools that accept CSV imports. Each tool has its own mapping step.",
  },
];

export default function ImportQuickbooksPage() {
  return (
    <>
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
      <JsonLd data={faqPageJsonLd(faqs)} />

      <Section>
        <Breadcrumbs crumbs={crumbs} />
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-balance text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Import Bank Statements into QuickBooks with a CSV Workflow
          </h1>
          <p className="mt-5 text-base leading-relaxed text-slate-600 sm:text-lg">
            QuickBooks imports structured files, not PDFs. The reliable path is to convert your PDF
            bank statement into a clean CSV first, review the columns and totals, then prepare that
            file for QuickBooks&apos; import workflow. StatementCSV is an independent tool and is not a
            QuickBooks integration or partner.
          </p>
          <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
            <ButtonLink href="/upload">Convert a statement</ButtonLink>
            <ButtonLink href="/bank-statement-to-csv" variant="secondary">
              Bank statement to CSV
            </ButtonLink>
          </div>
        </div>
      </Section>

      <Section muted>
        <div className="mx-auto max-w-3xl space-y-4 text-base leading-relaxed text-slate-600">
          <SectionHeading title="Why PDF statements do not import cleanly" />
          <p>
            A PDF stores how a statement looks, not a table of transactions. Accounting tools need
            rows and columns — a date, a description, and amounts — so a PDF dropped straight into
            QuickBooks either fails or imports garbled data. Converting to a clean CSV first gives the
            importer the structure it expects.
          </p>
        </div>
      </Section>

      <Section>
        <SectionHeading
          title="Step by step: PDF statement to QuickBooks-ready CSV"
          description="Convert, review, check totals, then map the columns in QuickBooks."
        />
        <div className="mt-12">
          <FeatureCards
            items={[
              {
                title: "1. Convert the PDF to CSV/Excel",
                body: "Upload the statement to StatementCSV and export a CSV (or Excel) with Date, Description, Debit, Credit, Amount, and Balance.",
              },
              {
                title: "2. Review the columns",
                body: "Confirm dates are consistent, descriptions are readable, and debit/credit amounts landed in the right columns. Edit any highlighted rows.",
              },
              {
                title: "3. Check the totals",
                body: "Use the balance check to confirm the rows reconcile against the statement before you rely on the file. A balance gap is never shown as verified.",
              },
              {
                title: "4. Prepare for QuickBooks import",
                body: "In QuickBooks, start a CSV/transaction import and map StatementCSV's columns to QuickBooks' expected fields, following QuickBooks' supported workflow.",
              },
            ]}
            columns={2}
          />
        </div>
      </Section>

      <Section muted>
        <SectionHeading
          title="Common CSV issues to watch for"
          description="A quick review avoids most import problems."
        />
        <div className="mt-12">
          <FeatureCards
            items={[
              {
                title: "Date format mismatches",
                body: "QuickBooks expects a specific date format during import; pick the matching format in its mapping step.",
              },
              {
                title: "Single vs split amounts",
                body: "Some imports want one signed amount, others want separate debit and credit columns. The export gives you both to map from.",
              },
              {
                title: "Extra header or total rows",
                body: "Remove any summary or opening/closing rows you do not want imported as transactions before mapping.",
              },
            ]}
            columns={3}
          />
        </div>
      </Section>

      <Section>
        <div className="mx-auto max-w-3xl">
          <SectionHeading title="QuickBooks CSV workflow FAQ" centered />
          <div className="mt-10">
            <FAQSection items={faqs} />
          </div>
          <p className="mt-6 text-center text-sm text-slate-600">
            New to converting statements? Start with the{" "}
            <Link href="/help/how-to-convert-bank-statement-pdf-to-csv" className="font-medium text-brand-700 hover:underline">
              PDF to CSV help guide
            </Link>
            .
          </p>
        </div>
      </Section>

      <RelatedPagesLinks
        muted
        links={[
          { label: "Bank statement to CSV", href: "/bank-statement-to-csv", description: "The main conversion page." },
          { label: "How to convert a PDF to CSV", href: "/help/how-to-convert-bank-statement-pdf-to-csv", description: "Step-by-step help guide." },
          { label: "Canadian bank statement to CSV", href: "/canadian-bank-statement-to-csv", description: "Common Canadian formats." },
          { label: "PDF to Excel", href: "/pdf-bank-statement-to-excel", description: "Open the data in Excel." },
          { label: "Sample output", href: "/sample", description: "See the cleaned data first." },
          { label: "Security", href: "/security", description: "How your statement data is handled." },
        ]}
      />

      <CTASection
        title="Convert a statement for QuickBooks"
        description="Upload a PDF, review the highlighted rows, and export a clean CSV to prepare for import."
      />
    </>
  );
}
