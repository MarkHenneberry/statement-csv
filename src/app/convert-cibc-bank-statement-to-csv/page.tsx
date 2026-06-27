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
import { DataRetentionTrustBlock } from "@/components/content/DataRetentionTrustBlock";
import { RelatedPagesLinks } from "@/components/content/RelatedPagesLinks";
import { absoluteUrl } from "@/lib/site";
import type { FaqItem } from "@/lib/faq";
import { breadcrumbJsonLd, faqPageJsonLd } from "@/lib/structured-data";

// TODO(launch-blocker): This CIBC page describes how the converter is designed to
// handle CIBC statements, but the parser has NOT been tested against real CIBC
// statement layouts. Validate parsing on actual CIBC PDFs before launch and
// soften or correct any wording that does not match real behavior.
const path = "/convert-cibc-bank-statement-to-csv";

export const metadata: Metadata = {
  title: "Convert CIBC Bank Statements to CSV and Excel",
  description:
    "Convert a CIBC bank statement to CSV, or a CIBC credit card statement to CSV. Upload a CIBC statement PDF, review the transactions, and download balance-checked CSV and Excel exports for bookkeeping.",
  alternates: {
    canonical: absoluteUrl(path),
  },
};

const crumbs = [
  { name: "Home", path: "/" },
  { name: "Convert CIBC statement to CSV", path },
];

const faqs: FaqItem[] = [
  {
    question: "How do I convert a CIBC bank statement to CSV?",
    answer:
      "Download the PDF statement from CIBC Online Banking, upload it here, review the extracted transactions, and download a CSV with Date, Description, Debit, Credit, Amount, and Balance. It works best with digital, text-based CIBC PDFs rather than scans.",
  },
  {
    question: "Can I convert a CIBC credit card statement to CSV?",
    answer:
      "Yes. A CIBC credit card statement, such as a CIBC Mastercard, converts into the same clean structure as chequing and savings statements, with purchases, payments, fees, and interest as separate rows you can review.",
  },
  {
    question: "Can I convert a CIBC statement to Excel?",
    answer:
      "Yes. You can export your reviewed CIBC transactions as a CSV that opens directly in Excel, Google Sheets, and Numbers, and Excel (.xlsx) export is available on the Pro plan.",
  },
  {
    question: "Which CIBC statements are supported?",
    answer:
      "StatementCSV is designed to support common CIBC chequing, savings, and credit card statement layouts. It does not work with every statement, so anything uncertain is highlighted for you to review before export.",
  },
  {
    question: "Is StatementCSV affiliated with CIBC?",
    answer:
      "No. StatementCSV is an independent tool and is not affiliated with or endorsed by CIBC. You upload a PDF you already have; there is no bank login.",
  },
];

export default function CibcPage() {
  return (
    <>
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
      <JsonLd data={faqPageJsonLd(faqs)} />

      <Section>
        <Breadcrumbs crumbs={crumbs} />
        <div className="max-w-3xl">
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            Convert CIBC Bank Statements to CSV
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-slate-600">
            Got a CIBC statement in a PDF? StatementCSV turns a CIBC bank statement into a
            clean CSV, and handles CIBC credit card statements too. It uses parser-first
            extraction with guided AI verification to pull out the transaction rows so you
            can review them and download balance-checked CSV and Excel exports. StatementCSV
            is an independent tool and is not affiliated with or endorsed by CIBC.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <ButtonLink href="/upload">Convert a Statement</ButtonLink>
            <ButtonLink href="/pricing" variant="secondary">
              See Pricing
            </ButtonLink>
          </div>
          <p className="mt-4 text-sm text-slate-500">
            No bank login. Not used for marketing.
          </p>
        </div>
      </Section>

      <Section muted>
        <SectionHeading
          title="How to convert a CIBC statement to CSV"
          description="You keep control of the file the whole time, and no CIBC login is ever required."
        />
        <div className="mt-12">
          <HowItWorks
            steps={[
              {
                title: "Export the CIBC PDF",
                body: "From CIBC Online Banking or the mobile app, open the statement you need and save it as a PDF.",
              },
              {
                title: "Run it through the converter",
                body: "Upload the PDF and preview the transactions detected before you commit.",
              },
              {
                title: "Export CSV or Excel",
                body: "Download the result and open it in Google Sheets, Excel, or your accounting tool.",
              },
            ]}
          />
        </div>
      </Section>

      <Section>
        <SectionHeading
          title="Clean CSV and Excel columns"
          description="Designed to follow how CIBC presents transactions on its statements."
        />
        <div className="mt-12">
          <FeatureCards
            items={[
              { title: "Date", body: "A clean transaction date on every row, ready to sort and filter." },
              { title: "Description", body: "CIBC transaction text, designed to be reassembled when it spreads across lines." },
              { title: "Debit & credit", body: "Money out and money in kept in separate, clearly labelled columns." },
              { title: "Balance", body: "The line-by-line balance whenever the CIBC statement includes it." },
            ]}
            columns={4}
          />
        </div>
        <div className="mx-auto mt-10 max-w-4xl">
          <OutputColumnsExample
            title="Example CIBC conversion (sample data)"
            caption="Example data — your CIBC statement produces its own rows. Review before export."
          />
        </div>
      </Section>

      <Section muted>
        <div className="mx-auto max-w-3xl">
          <SectionHeading title="Balance-checked, reviewable exports" />
          <div className="mt-6 space-y-4 text-base leading-relaxed text-slate-600">
            {/* TODO(launch-blocker): balance checks referenced here depend on the
                validation pipeline. Verify against real CIBC statements before launch. */}
            <p>
              Once the transactions are extracted, StatementCSV compares the totals against
              the opening and closing balances printed on your CIBC statement. A balance gap
              is never shown as a verified conversion, and the tool does not invent balancing
              rows to force a match.
            </p>
            <p>
              Uncertain rows are highlighted so you can review highlighted rows first, edit a
              cell, delete a row, or add a missing transaction before you export. We do not
              claim perfect accuracy, so always review the output before relying on it.
            </p>
          </div>
        </div>
      </Section>

      <Section>
        <SectionHeading
          title="Useful for CIBC bookkeeping and accounting"
          description="Get CIBC statement data into a spreadsheet you can actually work with."
        />
        <div className="mt-12">
          <FeatureCards
            items={[
              {
                title: "Reconciliation",
                body: "Filter a CIBC statement for a single payee or category and reconcile the month in minutes.",
              },
              {
                title: "Tax prep",
                body: "Combine several CIBC statements into one CSV and total deductible expenses for tax time.",
              },
              {
                title: "Accounting tools",
                body: "Prepare the columns for QuickBooks, Xero, or Wave — StatementCSV is not an official integration, so you map the file to each tool's import format.",
              },
            ]}
            columns={3}
          />
        </div>
      </Section>

      {/*
        TODO(launch-blocker): any retention/deletion wording remains a
        launch-blocker claim. Verify deletion and logging in the production
        pipeline before launch.
      */}
      <DataRetentionTrustBlock body="You never connect your CIBC account or share your online banking login — you only upload the statement PDF. Your statement is processed to create your spreadsheet file and is not sold or used for marketing or ads. When guided AI verification is used, it works from rendered statement images, not your original PDF." />

      <Section>
        <div className="mx-auto max-w-3xl">
          <SectionHeading title="CIBC conversion FAQ" centered />
          <div className="mt-10">
            <FAQSection items={faqs} />
          </div>
          <p className="mt-6 text-center text-sm text-slate-600">
            Banking elsewhere too? See{" "}
            <Link href="/convert-bmo-bank-statement-to-csv" className="font-medium text-brand-700 hover:underline">
              BMO
            </Link>
            ,{" "}
            <Link href="/convert-scotiabank-statement-to-csv" className="font-medium text-brand-700 hover:underline">
              Scotiabank
            </Link>
            , or the{" "}
            <Link href="/canadian-bank-statement-to-csv" className="font-medium text-brand-700 hover:underline">
              Canadian statements
            </Link>{" "}
            hub.
          </p>
        </div>
      </Section>

      <RelatedPagesLinks
        muted
        links={[
          { label: "Canadian bank statements", href: "/canadian-bank-statement-to-csv", description: "Common Canadian formats and all bank guides." },
          { label: "Bank statement to CSV", href: "/bank-statement-to-csv", description: "The main conversion page." },
          { label: "How to convert a PDF to CSV", href: "/help/how-to-convert-bank-statement-pdf-to-csv", description: "Step-by-step help guide." },
          { label: "BMO statements", href: "/convert-bmo-bank-statement-to-csv", description: "Designed for digital BMO PDFs." },
          { label: "Scotiabank statements", href: "/convert-scotiabank-statement-to-csv", description: "Designed for digital Scotiabank PDFs." },
          { label: "Security", href: "/security", description: "How your statement data is handled." },
        ]}
      />

      <CTASection
        title="Convert your CIBC statement now"
        description="Upload a PDF, review the highlighted rows, and download a clean CSV or Excel file."
      />
    </>
  );
}
