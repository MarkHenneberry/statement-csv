import type { Metadata } from "next";
import Link from "next/link";
import { Section, SectionHeading } from "@/components/Section";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { HowItWorks } from "@/components/HowItWorks";
import { FAQSection } from "@/components/FAQSection";
import { CTASection } from "@/components/CTASection";
import { ButtonLink } from "@/components/Button";
import { JsonLd } from "@/components/JsonLd";
import { OutputColumnsExample } from "@/components/content/OutputColumnsExample";
import { BuiltForBankStatementsBlock } from "@/components/content/BuiltForBankStatementsBlock";
import { WhoUsesThisTool } from "@/components/content/WhoUsesThisTool";
import { DataRetentionTrustBlock } from "@/components/content/DataRetentionTrustBlock";
import { RelatedPagesLinks } from "@/components/content/RelatedPagesLinks";
import { absoluteUrl } from "@/lib/site";
import { generalFaqs } from "@/lib/faq";
import { breadcrumbJsonLd, faqPageJsonLd } from "@/lib/structured-data";

const path = "/pdf-bank-statement-to-excel";

export const metadata: Metadata = {
  title: "Convert PDF Bank Statements to Excel",
  description:
    "Turn a PDF bank statement into a spreadsheet you can open in Excel or Google Sheets. Extract transaction rows — date, description, debit, credit, amount, balance — then sort, filter, and clean up for bookkeeping.",
  alternates: { canonical: absoluteUrl(path) },
};

const crumbs = [
  { name: "Home", path: "/" },
  { name: "PDF bank statement to Excel", path },
];

const faqs = generalFaqs.filter((faq) =>
  [
    "Can I convert a bank statement to Excel?",
    "Can I use the CSV in Excel or Google Sheets?",
    "What data is extracted from the bank statement?",
    "Is this different from a normal PDF to Excel converter?",
    "Are scanned statements supported?",
    "Do you keep my bank statement data?",
  ].includes(faq.question),
);

export default function PdfToExcelPage() {
  return (
    <>
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
      <JsonLd data={faqPageJsonLd(faqs)} />

      <Section>
        <Breadcrumbs crumbs={crumbs} />
        <div className="max-w-3xl">
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            Convert PDF Bank Statements to Excel
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-slate-600">
            Turn a PDF bank statement into a clean spreadsheet you can open in Excel or
            Google Sheets — with transaction rows in real columns instead of a flat,
            uneditable document.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <ButtonLink href="/upload">Convert a Statement</ButtonLink>
            <ButtonLink href="/sample" variant="secondary">
              See sample output
            </ButtonLink>
          </div>
          <p className="mt-4 text-sm text-slate-500">
            No bank login. Not used for marketing.
          </p>
        </div>
      </Section>

      <Section muted>
        <SectionHeading
          title="Upload, review, download"
          description="Three steps from a PDF statement to a spreadsheet-ready file."
        />
        <div className="mt-12">
          <HowItWorks
            steps={[
              {
                title: "Upload your PDF statement",
                body: "Use a digital PDF downloaded from your bank for the cleanest result.",
              },
              {
                title: "Review the transactions",
                body: "Check the dates, descriptions, debits, credits, and balances before exporting.",
              },
              {
                title: "Download for Excel",
                body: "Export a CSV that opens in Excel or Google Sheets — Excel export is included on Pro.",
              },
            ]}
          />
        </div>
      </Section>

      <Section>
        <SectionHeading
          title="What your spreadsheet looks like"
          description="Each transaction becomes a row you can sort, filter, and total."
        />
        <div className="mx-auto mt-10 max-w-4xl">
          <OutputColumnsExample
            title="Opened in Excel or Google Sheets"
            caption="Open the CSV directly, or export to Excel on the Pro plan."
          />
        </div>
      </Section>

      <BuiltForBankStatementsBlock
        muted
        body="A generic PDF-to-Excel converter tries to lift any table out of any document, which often scrambles a bank statement. StatementCSV is designed around statement data — transaction rows, debit and credit columns, running balances, and repeated headers across multi-page statements — so the spreadsheet you download is actually usable for bookkeeping and reconciliation."
      />

      <Section>
        <SectionHeading
          title="Clean up statements in your spreadsheet"
          description="Once the data is in Excel or Google Sheets, the slow part is done."
        />
        <ul className="mx-auto mt-8 max-w-3xl space-y-3 text-base text-slate-700">
          <li>Sort by date or amount to find the largest transactions quickly.</li>
          <li>Filter by description to isolate a single merchant or category.</li>
          <li>Total a column for expenses, taxes, or budgeting.</li>
          <li>Prepare the rows for import into accounting tools like QuickBooks or Xero.</li>
        </ul>
      </Section>

      <WhoUsesThisTool muted />

      <DataRetentionTrustBlock />

      <RelatedPagesLinks
        muted
        heading="Keep exploring"
        links={[
          { label: "PDF to CSV", href: "/pdf-bank-statement-to-csv", description: "The general PDF bank statement to CSV guide." },
          { label: "Bank statement parser", href: "/bank-statement-parser", description: "How the structured extraction works." },
          { label: "Sample output", href: "/sample", description: "See an example of the cleaned data." },
          { label: "Security", href: "/security", description: "How your statement data is handled." },
          { label: "RBC statements", href: "/convert-rbc-bank-statement-to-csv", description: "Designed for digital RBC PDFs." },
          { label: "Pricing", href: "/pricing", description: "Free preview, then page-based plans." },
        ]}
      />

      <Section>
        <div className="mx-auto max-w-3xl">
          <SectionHeading title="Frequently asked questions" centered />
          <div className="mt-10">
            <FAQSection items={faqs} />
          </div>
          <p className="mt-6 text-center text-sm text-slate-600">
            Prefer a plain CSV walkthrough? See the{" "}
            <Link href="/pdf-bank-statement-to-csv" className="font-medium text-brand-700 hover:underline">
              PDF to CSV
            </Link>{" "}
            guide.
          </p>
        </div>
      </Section>

      <CTASection
        title="Turn your statement into a spreadsheet"
        description="Upload a PDF, review the transactions, and download a clean file for Excel or Google Sheets."
        secondaryCta={{ label: "See sample output", href: "/sample" }}
      />
    </>
  );
}
