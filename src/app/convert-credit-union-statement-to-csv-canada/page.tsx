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

// TODO(launch-blocker): This credit union page describes how the converter is
// designed to handle Canadian credit union statements, but formats vary widely by
// institution and the parser has NOT been validated against real credit union
// PDFs. Verify parsing before launch and keep the "formats vary / review" framing.
const path = "/convert-credit-union-statement-to-csv-canada";

export const metadata: Metadata = {
  title: "Convert Canadian Credit Union Statements to CSV",
  description:
    "Convert a Canadian credit union statement PDF to CSV or Excel. Upload your credit union statement, review the highlighted rows, and download balance-checked exports. Formats vary by institution, so you review before export.",
  alternates: {
    canonical: absoluteUrl(path),
  },
};

const crumbs = [
  { name: "Home", path: "/" },
  { name: "Convert credit union statement to CSV", path },
];

const faqs: FaqItem[] = [
  {
    question: "How do I convert a credit union statement to CSV in Canada?",
    answer:
      "Download the PDF statement from your credit union's online banking, upload it here, review the extracted transactions, and download a CSV with Date, Description, Debit, Credit, Amount, and Balance. It works best with digital, text-based PDFs rather than scans.",
  },
  {
    question: "Which Canadian credit unions are supported?",
    answer:
      "Credit union statement formats vary by institution. StatementCSV is designed to support common Canadian credit union statement layouts, but it does not work with every format, so uncertain rows are highlighted for you to review before export.",
  },
  {
    question: "Can I export a credit union statement to Excel?",
    answer:
      "Yes. You can export your reviewed transactions as a CSV that opens directly in Excel, Google Sheets, and Numbers, and Excel (.xlsx) export is available on the Pro plan.",
  },
  {
    question: "Can I convert a credit union credit card or line of credit statement?",
    answer:
      "Often, yes. Credit card and line-of-credit statements convert into the same clean structure as chequing and savings statements. Because layouts differ between institutions, review the highlighted rows before relying on the file.",
  },
  {
    question: "Is StatementCSV affiliated with my credit union?",
    answer:
      "No. StatementCSV is an independent tool and is not affiliated with or endorsed by any credit union. You upload a PDF you already have; there is no bank login.",
  },
];

export default function CreditUnionPage() {
  return (
    <>
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
      <JsonLd data={faqPageJsonLd(faqs)} />

      <Section>
        <Breadcrumbs crumbs={crumbs} />
        <div className="max-w-3xl">
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            Convert Canadian Credit Union Statements to CSV and Excel
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-slate-600">
            Need to turn a Canadian credit union statement PDF into a spreadsheet?
            StatementCSV uses parser-first extraction with guided AI verification to pull the
            transaction rows out of your credit union statement so you can review them and
            download balance-checked CSV and Excel exports. Credit union formats vary by
            institution, so you always review highlighted rows before export. StatementCSV is
            an independent tool and is not affiliated with or endorsed by any credit union.
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
          title="How to convert a credit union statement to CSV"
          description="Nothing to install, and you never sign in to your credit union through this tool."
        />
        <div className="mt-12">
          <HowItWorks
            steps={[
              {
                title: "Download the PDF",
                body: "In your credit union's online banking or app, open the statement you need and save the PDF version.",
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
          description="Designed to support common Canadian credit union statement layouts."
        />
        <div className="mt-12">
          <FeatureCards
            items={[
              { title: "Date", body: "A uniform transaction date on every posted row, ready to sort." },
              { title: "Description", body: "Transaction details rejoined into one row when they wrap across lines." },
              { title: "Debit & credit", body: "Money out and money in kept in their own clearly labelled columns." },
              { title: "Balance", body: "The running account balance wherever the statement lists one." },
            ]}
            columns={4}
          />
        </div>
        <div className="mx-auto mt-10 max-w-4xl">
          <OutputColumnsExample
            title="Example credit union conversion (sample data)"
            caption="Example data — your credit union statement produces its own rows. Review before export."
          />
        </div>
      </Section>

      <Section muted>
        <div className="mx-auto max-w-3xl">
          <SectionHeading title="Formats vary — so you review before export" />
          <div className="mt-6 space-y-4 text-base leading-relaxed text-slate-600">
            {/* TODO(launch-blocker): balance checks referenced here depend on the
                validation pipeline. Credit union layouts vary widely; verify on real
                statements before launch and keep the review-first framing. */}
            <p>
              Canadian credit unions use a wide range of statement layouts, so StatementCSV
              treats credit union conversions as review-first. After extraction, it compares
              the totals against the opening and closing balances printed on your statement.
              A balance gap is never shown as a verified conversion, and the tool does not
              invent balancing rows to force a match.
            </p>
            <p>
              Uncertain rows are highlighted so you can review highlighted rows first, edit a
              cell, delete a row, or add a missing transaction before you export. We do not
              claim perfect accuracy or support for every institution, so always review the
              output before relying on it.
            </p>
          </div>
        </div>
      </Section>

      <Section>
        <SectionHeading
          title="Useful for bookkeeping and accounting"
          description="Get credit union statement data into the spreadsheet your workflow expects."
        />
        <div className="mt-12">
          <FeatureCards
            items={[
              {
                title: "Reconciliation",
                body: "Sort a statement by date or amount and reconcile a month without retyping rows.",
              },
              {
                title: "Tax prep",
                body: "Stack several statements into one CSV and total deductible expenses for tax season.",
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
      <DataRetentionTrustBlock body="You never connect your credit union account or share your online banking login — you only upload the statement PDF. Your statement is processed to create your spreadsheet file and is not sold or used for marketing or ads. When guided AI verification is used, it works from rendered statement images, not your original PDF." />

      <Section>
        <div className="mx-auto max-w-3xl">
          <SectionHeading title="Credit union conversion FAQ" centered />
          <div className="mt-10">
            <FAQSection items={faqs} />
          </div>
          <p className="mt-6 text-center text-sm text-slate-600">
            Banking with a major bank too? See the{" "}
            <Link href="/canadian-bank-statement-to-csv" className="font-medium text-brand-700 hover:underline">
              Canadian statements
            </Link>{" "}
            hub for RBC, TD, BMO, CIBC, and Scotiabank guides.
          </p>
        </div>
      </Section>

      <RelatedPagesLinks
        muted
        links={[
          { label: "Canadian bank statements", href: "/canadian-bank-statement-to-csv", description: "Common Canadian formats and all bank guides." },
          { label: "Bank statement to CSV", href: "/bank-statement-to-csv", description: "The main conversion page." },
          { label: "How to convert a PDF to CSV", href: "/help/how-to-convert-bank-statement-pdf-to-csv", description: "Step-by-step help guide." },
          { label: "PDF to Excel", href: "/pdf-bank-statement-to-excel", description: "Open the data in Excel." },
          { label: "Sample output", href: "/sample", description: "See the cleaned data first." },
          { label: "Security", href: "/security", description: "How your statement data is handled." },
        ]}
      />

      <CTASection
        title="Convert your credit union statement now"
        description="Upload a PDF, review the highlighted rows, and download a clean CSV or Excel file."
      />
    </>
  );
}
