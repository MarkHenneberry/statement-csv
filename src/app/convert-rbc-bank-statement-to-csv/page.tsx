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
import { generalFaqs } from "@/lib/faq";
import { breadcrumbJsonLd, faqPageJsonLd } from "@/lib/structured-data";

// TODO(launch-blocker): This RBC page describes how the converter is designed to
// handle RBC statements, but the parser has NOT been tested against real RBC
// statement layouts. Validate parsing on actual RBC PDFs before launch and
// soften or correct any wording that does not match real behavior.
const path = "/convert-rbc-bank-statement-to-csv";

export const metadata: Metadata = {
  title: "Convert RBC Bank Statements to CSV",
  description:
    "Turn an RBC bank statement PDF into a clean CSV for Excel, Google Sheets, or bookkeeping. Upload your RBC statement, review the transactions, and download a spreadsheet-ready file.",
  alternates: {
    canonical: absoluteUrl(path),
  },
};

const crumbs = [
  { name: "Home", path: "/" },
  { name: "Convert RBC statement to CSV", path },
];

const rbcFaqs = generalFaqs.filter((faq) =>
  [
    "Which banks are supported?",
    "What are balance checks?",
    "Are scanned statements supported?",
    "What columns are included in the CSV?",
    "Do I need to connect my bank account?",
  ].includes(faq.question),
);

export default function RbcPage() {
  return (
    <>
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
      <JsonLd data={faqPageJsonLd(rbcFaqs)} />

      <Section>
        <Breadcrumbs crumbs={crumbs} />
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-balance text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Convert RBC Bank Statements to CSV
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-slate-600">
            Have an RBC statement saved as a PDF? StatementCSV is designed for digital PDF
            statements downloaded from RBC. It extracts the transaction rows from your
            chequing, savings, or credit card statement so you can review them and download
            a clean CSV. StatementCSV is an independent tool and is not affiliated with or
            endorsed by RBC.
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
          title="How to convert an RBC statement to CSV"
          description="There is nothing to install, and you never sign in to RBC through this tool."
        />
        <div className="mt-12">
          <HowItWorks
            steps={[
              {
                title: "Save your RBC statement as PDF",
                body: "In RBC Online Banking, open the statement you want and download the PDF version.",
              },
              {
                title: "Upload it here",
                body: "Drop the PDF in and review the dates, descriptions, and amounts we pull out.",
              },
              {
                title: "Download your CSV",
                body: "Grab the finished file and open it in Excel, Google Sheets, or your bookkeeping app.",
              },
            ]}
          />
        </div>
      </Section>

      <Section>
        <SectionHeading
          title="What columns are included"
          description="The export is designed to mirror the way RBC lays out its statements."
        />
        <div className="mt-12">
          <FeatureCards
            items={[
              { title: "Date", body: "The transaction date for each posted item, in a uniform format." },
              { title: "Description", body: "The RBC transaction details, joined back together when they wrap." },
              { title: "Withdrawals & deposits", body: "Debit and credit amounts kept in their own columns." },
              { title: "Balance", body: "The running account balance where the statement lists one." },
            ]}
            columns={4}
          />
        </div>
        <div className="mx-auto mt-10 max-w-4xl">
          <OutputColumnsExample
            title="Example RBC conversion (sample data)"
            caption="Example data — your RBC statement produces its own rows. Review before export."
          />
        </div>
      </Section>

      <Section muted>
        <div className="grid items-start gap-8 lg:grid-cols-2">
          <div>
            <SectionHeading title="Why convert an RBC PDF to CSV?" centered={false} />
            <div className="mt-6 space-y-4 text-base leading-relaxed text-slate-600">
              <p>
                RBC gives you a clear PDF to read, but it is awkward when you need to do
                anything with the numbers. Tallying interest, separating business spending,
                or importing into accounting software all want columns, not a printout.
              </p>
              <p>
                A CSV lets you sort an RBC statement by date or amount, filter for a single
                payee, and feed the data straight into QuickBooks, Xero, or Wave. For tax
                season, you can stack several months into one file and total your
                deductible expenses in a few clicks.
              </p>
              {/* TODO(launch-blocker): AI-assisted extraction and balance checks
                  referenced here depend on the unbuilt parser and validation
                  pipeline. Verify before launch. */}
              <p>
                Parser-first extraction with guided AI verification helps make sense of
                RBC&apos;s wrapped descriptions and split debit and credit columns, while balance
                checks compare the totals against the statement so you can review highlighted
                rows before you export.
              </p>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-surface p-6 shadow-card">
            <p className="text-sm font-semibold text-slate-900">Example RBC export</p>
            <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-50 p-4 text-xs text-slate-600">
{`Date,Description,Withdrawals,Deposits,Balance
2024-06-01,Opening Balance,,,2100.00
2024-06-03,Interac Purchase - Grocer,52.10,,2047.90
2024-06-05,Payroll Deposit,,1850.00,3897.90`}
            </pre>
          </div>
        </div>
      </Section>

      <Section>
        <SectionHeading
          title="Common RBC statement formatting issues"
          description="A few quirks show up often in RBC PDFs. The converter is designed to handle them, and you review the result before export."
        />
        <div className="mt-12">
          <FeatureCards
            items={[
              {
                title: "Wrapped descriptions",
                body: "Long Interac and bill-payment details often span two lines. The parser is designed to rejoin them into one row.",
              },
              {
                title: "Separate debit and credit columns",
                body: "RBC splits withdrawals and deposits. The converter is designed to keep them apart rather than guess a single signed amount.",
              },
              {
                title: "Opening and closing balances",
                body: "Summary balance lines are treated as context, so they are kept distinct from regular transactions.",
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
      <DataRetentionTrustBlock body="You never connect your RBC account or share your online banking login — you only upload the statement PDF. Your statement is processed to create your spreadsheet file and is not sold or used for marketing or ads. When guided AI verification is used, it works from rendered statement images, not your original PDF." />

      <Section>
        <div className="mx-auto max-w-3xl">
          <SectionHeading title="RBC conversion FAQ" centered />
          <div className="mt-10">
            <FAQSection items={rbcFaqs} />
          </div>
          <p className="mt-6 text-center text-sm text-slate-600">
            Banking with TD too? See the{" "}
            <Link
              href="/convert-td-bank-statement-to-csv"
              className="font-medium text-brand-700 hover:underline"
            >
              TD statement to CSV
            </Link>{" "}
            guide, or the general{" "}
            <Link
              href="/pdf-bank-statement-to-csv"
              className="font-medium text-brand-700 hover:underline"
            >
              PDF to CSV
            </Link>{" "}
            walkthrough.
          </p>
        </div>
      </Section>

      <RelatedPagesLinks
        muted
        links={[
          { label: "Canadian bank statements", href: "/canadian-bank-statement-to-csv", description: "All bank guides and common formats." },
          { label: "TD statements", href: "/convert-td-bank-statement-to-csv", description: "Designed for digital TD PDFs." },
          { label: "PDF to CSV", href: "/pdf-bank-statement-to-csv", description: "The general conversion guide." },
          { label: "PDF to Excel", href: "/pdf-bank-statement-to-excel", description: "Open the data in Excel." },
          { label: "Security", href: "/security", description: "How your statement data is handled." },
          { label: "Sample output", href: "/sample", description: "See the cleaned data." },
        ]}
      />

      <CTASection
        title="Convert your RBC statement now"
        description="Upload a PDF, review the transactions, and download a clean CSV."
      />
    </>
  );
}
