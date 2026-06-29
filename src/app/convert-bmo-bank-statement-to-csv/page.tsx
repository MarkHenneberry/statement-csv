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

// TODO(launch-blocker): This BMO page describes how the converter is designed to
// handle BMO statements, but the parser has NOT been tested against real BMO
// statement layouts. Validate parsing on actual BMO PDFs before launch and
// soften or correct any wording that does not match real behavior.
const path = "/convert-bmo-bank-statement-to-csv";

export const metadata: Metadata = {
  title: "Convert BMO Bank Statements to CSV and Excel",
  description:
    "Convert a BMO bank statement to CSV, or a BMO credit card statement to CSV. Upload a BMO statement PDF, review the transactions, and download balance-checked CSV and Excel exports for bookkeeping.",
  alternates: {
    canonical: absoluteUrl(path),
  },
};

const crumbs = [
  { name: "Home", path: "/" },
  { name: "Convert BMO statement to CSV", path },
];

const faqs: FaqItem[] = [
  {
    question: "How do I convert a BMO bank statement to CSV?",
    answer:
      "Download the PDF statement from BMO Online Banking, upload it here, review the extracted transactions, and download a CSV with Date, Description, Debit, Credit, Amount, and Balance. It works best with digital, text-based BMO PDFs rather than scans.",
  },
  {
    question: "Can I convert a BMO credit card statement to CSV?",
    answer:
      "Yes. A BMO Mastercard or other BMO credit card statement converts into the same clean structure as chequing and savings statements, with purchases, payments, fees, and interest as separate rows you can review.",
  },
  {
    question: "Can I convert a BMO statement to Excel?",
    answer:
      "Yes. You can export your reviewed BMO transactions as a CSV that opens directly in Excel, Google Sheets, and Numbers, and Excel (.xlsx) export is available on the Pro plan.",
  },
  {
    question: "Which BMO statements are supported?",
    answer:
      "StatementCSV is designed to support common BMO chequing, savings, and credit card statement layouts. It does not work with every statement, so anything uncertain is highlighted for you to review before export.",
  },
  {
    question: "Is StatementCSV affiliated with BMO?",
    answer:
      "No. StatementCSV is an independent tool and is not affiliated with or endorsed by BMO. You upload a PDF you already have; there is no bank login.",
  },
];

export default function BmoPage() {
  return (
    <>
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
      <JsonLd data={faqPageJsonLd(faqs)} />

      <Section>
        <Breadcrumbs crumbs={crumbs} />
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-balance text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Convert BMO Bank Statements to CSV
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-slate-600">
            Have a BMO statement saved as a PDF? StatementCSV turns a BMO bank statement
            into a clean CSV, and handles BMO credit card statements too. It uses
            parser-first extraction with guided AI verification to pull out the transaction
            rows so you can review them and download balance-checked CSV and Excel exports.
            StatementCSV is an independent tool and is not affiliated with or endorsed by
            BMO.
          </p>
          <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
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
          title="How to convert a BMO statement to CSV"
          description="Nothing to install, and you never sign in to BMO through this tool."
        />
        <div className="mt-12">
          <HowItWorks
            steps={[
              {
                title: "Download the BMO PDF",
                body: "In BMO Online Banking or the app, open the statement you need and save the PDF version.",
              },
              {
                title: "Upload it here",
                body: "Drop the PDF in and review the dates, descriptions, and amounts that come out.",
              },
              {
                title: "Export CSV or Excel",
                body: "Download the finished file and open it in Excel, Google Sheets, or your bookkeeping app.",
              },
            ]}
          />
        </div>
      </Section>

      <Section>
        <SectionHeading
          title="Clean CSV and Excel columns"
          description="Designed to follow how BMO lays out chequing, savings, and card statements."
        />
        <div className="mt-12">
          <FeatureCards
            items={[
              { title: "Date", body: "A uniform transaction date on every posted row, ready to sort." },
              { title: "Description", body: "BMO transaction details, rejoined into one row when they wrap across lines." },
              { title: "Debit & credit", body: "Money out and money in kept in their own clearly labelled columns." },
              { title: "Balance", body: "The running account balance wherever the BMO statement lists one." },
            ]}
            columns={4}
          />
        </div>
        <div className="mx-auto mt-10 max-w-4xl">
          <OutputColumnsExample
            title="Example BMO conversion (sample data)"
            caption="Example data — your BMO statement produces its own rows. Review before export."
          />
        </div>
      </Section>

      <Section muted>
        <div className="mx-auto max-w-3xl">
          <SectionHeading title="Balance-checked, reviewable exports" />
          <div className="mt-6 space-y-4 text-base leading-relaxed text-slate-600">
            {/* TODO(launch-blocker): balance checks referenced here depend on the
                validation pipeline. Verify against real BMO statements before launch. */}
            <p>
              After the transactions are extracted, StatementCSV compares the totals against
              the opening and closing balances printed on your BMO statement. A balance gap
              is never shown as a verified conversion, and the tool does not invent balancing
              rows to force a match.
            </p>
            <p>
              Uncertain rows are highlighted so you can review highlighted rows first, edit a
              cell, delete a row, or add a missing transaction before you export. We do not
              claim perfect accuracy, so the review step is where accuracy comes from.
            </p>
          </div>
        </div>
      </Section>

      <Section>
        <SectionHeading
          title="Useful for BMO bookkeeping and accounting"
          description="Get BMO statement data into the spreadsheet your workflow expects."
        />
        <div className="mt-12">
          <FeatureCards
            items={[
              {
                title: "Reconciliation",
                body: "Sort a BMO statement by date or amount and reconcile a month without retyping rows.",
              },
              {
                title: "Tax prep",
                body: "Stack several BMO statements into one CSV and total deductible expenses for tax season.",
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
      <DataRetentionTrustBlock body="You never connect your BMO account or share your online banking login — you only upload the statement PDF. Your statement is processed to create your spreadsheet file and is not sold or used for marketing or ads. When guided AI verification is used, it works from rendered statement images, not your original PDF." />

      <Section>
        <div className="mx-auto max-w-3xl">
          <SectionHeading title="BMO conversion FAQ" centered />
          <div className="mt-10">
            <FAQSection items={faqs} />
          </div>
          <p className="mt-6 text-center text-sm text-slate-600">
            Banking elsewhere too? See{" "}
            <Link href="/convert-cibc-bank-statement-to-csv" className="font-medium text-brand-700 hover:underline">
              CIBC
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
          { label: "CIBC statements", href: "/convert-cibc-bank-statement-to-csv", description: "Designed for digital CIBC PDFs." },
          { label: "Scotiabank statements", href: "/convert-scotiabank-statement-to-csv", description: "Designed for digital Scotiabank PDFs." },
          { label: "Security", href: "/security", description: "How your statement data is handled." },
        ]}
      />

      <CTASection
        title="Convert your BMO statement now"
        description="Upload a PDF, review the highlighted rows, and download a clean CSV or Excel file."
      />
    </>
  );
}
