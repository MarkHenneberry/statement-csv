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
import { BankStatementTechnicalExplainer } from "@/components/content/BankStatementTechnicalExplainer";
import { BuiltForBankStatementsBlock } from "@/components/content/BuiltForBankStatementsBlock";
import { WhoUsesThisTool } from "@/components/content/WhoUsesThisTool";
import { DataRetentionTrustBlock } from "@/components/content/DataRetentionTrustBlock";
import { RelatedPagesLinks } from "@/components/content/RelatedPagesLinks";
import { absoluteUrl } from "@/lib/site";
import { generalFaqs } from "@/lib/faq";
import { breadcrumbJsonLd, faqPageJsonLd } from "@/lib/structured-data";

const path = "/pdf-bank-statement-to-csv";

export const metadata: Metadata = {
  title: "PDF Bank Statement to CSV: Convert in Minutes",
  description:
    "Convert a PDF bank statement to CSV without retyping. Upload the PDF, review the extracted transactions, and download a spreadsheet-ready file for Excel or Google Sheets.",
  alternates: {
    canonical: absoluteUrl(path),
  },
};

const crumbs = [
  { name: "Home", path: "/" },
  { name: "PDF bank statement to CSV", path },
];

const csvIncludes = [
  { title: "Date", body: "A consistent, sortable date for every transaction row." },
  { title: "Description", body: "The merchant or memo text from each line of the statement." },
  { title: "Amount", body: "Debits and credits as separate columns or a single signed value." },
  { title: "Balance", body: "A running balance when your statement prints one per line." },
];

const faqs = generalFaqs.filter((faq) =>
  [
    "Can I convert a PDF bank statement to CSV?",
    "What are balance checks?",
    "Are scanned statements supported?",
    "What columns are included in the CSV?",
    "What happens if a statement does not convert correctly?",
    "Is my bank statement stored?",
  ].includes(faq.question),
);

export default function PdfToCsvPage() {
  return (
    <>
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
      <JsonLd data={faqPageJsonLd(faqs)} />

      <Section>
        <Breadcrumbs crumbs={crumbs} />
        <div className="max-w-3xl">
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            Convert PDF Bank Statements to CSV
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-slate-600">
            A PDF is fine for reading, but it is the wrong format for a spreadsheet.
            StatementCSV is a bank statement converter that extracts the transaction data
            from your PDF and turns it into a clean CSV you can open in Excel, Google
            Sheets, or your accounting tool &mdash; without retyping a single row.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <ButtonLink href="/upload">Convert a Statement</ButtonLink>
            <ButtonLink href="/pricing" variant="secondary">
              See Pricing
            </ButtonLink>
          </div>
          <p className="mt-4 text-sm text-slate-500">
            No bank login. No ads. No stored statement data.
          </p>
        </div>
      </Section>

      <Section muted>
        <SectionHeading
          title="How to convert a PDF bank statement to CSV"
          description="No installs and no bank connection. You work only from the PDF you already have."
        />
        <div className="mt-12">
          <HowItWorks
            steps={[
              {
                title: "Download the PDF from your bank",
                body: "Use the original statement PDF from online banking for the cleanest results.",
              },
              {
                title: "Upload and review",
                body: "We pull out the dates, descriptions, and amounts so you can check them first.",
              },
              {
                title: "Download the CSV",
                body: "Export a spreadsheet-ready file and open it anywhere CSV is supported.",
              },
            ]}
          />
        </div>
      </Section>

      <Section>
        <SectionHeading
          title="What the CSV includes"
          description="Every statement becomes consistent rows and columns you can sort, filter, and total."
        />
        <div className="mt-12">
          <FeatureCards items={csvIncludes} columns={4} />
        </div>
      </Section>

      <BankStatementTechnicalExplainer
        muted
        eyebrow="From PDF to data"
        heading="From PDF statement to structured CSV data"
        intro="The converter is built for bank statements, so it focuses on the transaction rows rather than the whole document."
        points={[
          "The tool identifies transaction lines.",
          "It separates descriptions from amounts.",
          "It keeps debits and credits in separate fields.",
          "It calculates amount from debit/credit.",
          "It includes balances where available.",
          "It flags rows that may need review.",
          "The CSV can be opened in Excel, Google Sheets, or used for bookkeeping cleanup.",
        ]}
      />

      <Section>
        <SectionHeading
          title="What the structured CSV looks like"
          description="Each transaction line becomes a row of clean, spreadsheet-ready fields."
        />
        <div className="mx-auto mt-10 max-w-4xl">
          <OutputColumnsExample />
        </div>
      </Section>

      <Section muted>
        <div className="grid items-start gap-12 lg:grid-cols-2">
          <div>
            <SectionHeading title="Why PDFs are hard to work with" />
            <div className="mt-6 space-y-4 text-base leading-relaxed text-slate-600">
              <p>
                A PDF stores text for display, not for data. Columns that look neat on
                screen are often stored as loose fragments, so copying and pasting
                scrambles dates, descriptions, and amounts.
              </p>
              <p>
                Long descriptions wrap onto a second line, negative amounts lose their
                minus sign, and totals get mixed in with transactions. Fixing that by hand
                is slow and error-prone, especially across many months.
              </p>
              <p>
                Converting the PDF to CSV solves this at the source: the data lands in real
                columns, ready for formulas and imports.
              </p>
              {/* TODO(launch-blocker): AI-assisted extraction and balance checks
                  described below depend on the parser and validation pipeline,
                  which are not built yet. Verify before launch. */}
              <p>
                AI-assisted extraction helps handle messy statement layouts, while balance
                checks help catch missing or misread transactions before you export. You
                review the results yourself, so you stay in control of the final file.
              </p>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <p className="text-sm font-semibold text-slate-900">Sample CSV output</p>
            <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-50 p-4 text-xs text-slate-600">
{`Date,Description,Amount,Balance
2024-05-01,Opening Balance,,1500.00
2024-05-03,Coffee Shop,-4.75,1495.25
2024-05-04,Payroll Deposit,2100.00,3595.25`}
            </pre>
            <p className="mt-4 text-sm text-slate-500">
              Columns adapt to what your statement provides.
            </p>
          </div>
        </div>
      </Section>

      <Section>
        <SectionHeading
          title="CSV for Excel, Google Sheets, bookkeeping, and taxes"
          description="One clean file works across the tools you already use."
        />
        <div className="mt-12">
          <FeatureCards
            items={[
              {
                title: "Excel & Google Sheets",
                body: "Open instantly to sort by date, filter by merchant, or sum a category.",
              },
              {
                title: "Bookkeeping",
                body: "Import into QuickBooks, Xero, or Wave instead of manual entry.",
              },
              {
                title: "Taxes",
                body: "Combine a year of statements to total deductible expenses.",
              },
              {
                title: "Budgeting",
                body: "Drop transactions into a budget template without retyping them.",
              },
            ]}
            columns={4}
          />
        </div>
      </Section>

      <BuiltForBankStatementsBlock
        muted
        body="A generic PDF-to-CSV tool tries to lift any table out of any document. StatementCSV is designed around bank statement data — transaction rows, debit and credit columns, running balances, repeated headers across multi-page statements, and review warnings — so the CSV you download is ready for bookkeeping, not a scrambled copy of a PDF."
      />

      <WhoUsesThisTool />

      {/*
        TODO(launch-blocker): The "we do not keep your bank statement data"
        message below is a launch-blocker claim. The deletion and logging
        pipeline must be implemented and verified before launch.
      */}
      <DataRetentionTrustBlock />

      <Section>
        <div className="mx-auto max-w-3xl">
          <SectionHeading title="Frequently asked questions" centered />
          <div className="mt-10">
            <FAQSection items={faqs} />
          </div>
          <p className="mt-6 text-center text-sm text-slate-600">
            Have a bank-specific statement? See the{" "}
            <Link
              href="/convert-rbc-bank-statement-to-csv"
              className="font-medium text-brand-700 hover:underline"
            >
              RBC
            </Link>{" "}
            and{" "}
            <Link
              href="/convert-td-bank-statement-to-csv"
              className="font-medium text-brand-700 hover:underline"
            >
              TD
            </Link>{" "}
            guides.
          </p>
        </div>
      </Section>

      <RelatedPagesLinks
        muted
        links={[
          { label: "PDF to Excel", href: "/pdf-bank-statement-to-excel", description: "Open the data in Excel or Google Sheets." },
          { label: "Bank statement parser", href: "/bank-statement-parser", description: "How structured extraction works." },
          { label: "Sample output", href: "/sample", description: "See the cleaned data before you upload." },
          { label: "Security", href: "/security", description: "How your statement data is handled." },
          { label: "RBC statements", href: "/convert-rbc-bank-statement-to-csv", description: "Designed for digital RBC PDFs." },
          { label: "TD statements", href: "/convert-td-bank-statement-to-csv", description: "Designed for digital TD PDFs." },
        ]}
      />

      <CTASection />
    </>
  );
}
