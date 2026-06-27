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

// TODO(launch-blocker): This TD page describes how the converter is designed to
// handle TD statements, but the parser has NOT been tested against real TD
// statement layouts. Validate parsing on actual TD PDFs before launch and
// soften or correct any wording that does not match real behavior.
const path = "/convert-td-bank-statement-to-csv";

export const metadata: Metadata = {
  title: "Convert TD Bank Statements to CSV",
  description:
    "Change a TD bank statement PDF into a clean CSV for spreadsheets and bookkeeping. Upload your TD statement, check the extracted rows, and download a ready-to-use file.",
  alternates: {
    canonical: absoluteUrl(path),
  },
};

const crumbs = [
  { name: "Home", path: "/" },
  { name: "Convert TD statement to CSV", path },
];

const tdFaqs = generalFaqs.filter((faq) =>
  [
    "Which banks are supported?",
    "Does AI read my bank statement?",
    "What happens if a statement does not convert correctly?",
    "Can I use the CSV in Excel or Google Sheets?",
    "Is this free?",
  ].includes(faq.question),
);

export default function TdPage() {
  return (
    <>
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
      <JsonLd data={faqPageJsonLd(tdFaqs)} />

      <Section>
        <Breadcrumbs crumbs={crumbs} />
        <div className="max-w-3xl">
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            Convert TD Bank Statements to CSV
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-slate-600">
            Got a TD statement sitting in a PDF? StatementCSV is designed for digital PDF
            statements downloaded from TD. It extracts the transaction rows from your TD
            account or credit card statement so you can review them and download a clean
            CSV. StatementCSV is an independent tool and is not affiliated with or endorsed
            by TD.
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
          title="How to convert a TD statement to CSV"
          description="You stay in control of the file the whole time, and no TD login is ever required."
        />
        <div className="mt-12">
          <HowItWorks
            steps={[
              {
                title: "Export the PDF from TD",
                body: "From EasyWeb or the TD app, open the statement you need and save it as a PDF.",
              },
              {
                title: "Send it through the converter",
                body: "Upload the PDF and preview the transactions we detect before you commit.",
              },
              {
                title: "Save your CSV",
                body: "Download the result and open it in Google Sheets, Excel, or your accounting tool.",
              },
            ]}
          />
        </div>
      </Section>

      <Section>
        <SectionHeading
          title="What columns are included"
          description="The layout is designed to follow how TD presents transactions on its statements."
        />
        <div className="mt-12">
          <FeatureCards
            items={[
              { title: "Date", body: "A clean transaction date on every row, ready to sort." },
              { title: "Description", body: "TD's transaction text, designed to be reassembled when it spreads across lines." },
              { title: "Debit & credit", body: "Money out and money in, kept in clearly labelled columns." },
              { title: "Balance", body: "The line-by-line balance whenever the TD statement includes it." },
            ]}
            columns={4}
          />
        </div>
        <div className="mx-auto mt-10 max-w-4xl">
          <OutputColumnsExample
            title="Example TD conversion (sample data)"
            caption="Example data — your TD statement produces its own rows. Review before export."
          />
        </div>
      </Section>

      <Section muted>
        <div className="grid items-start gap-12 lg:grid-cols-2">
          <div>
            <SectionHeading title="Why convert a TD PDF to CSV?" />
            <div className="mt-6 space-y-4 text-base leading-relaxed text-slate-600">
              <p>
                A TD PDF is easy to glance at, but the moment you need to add things up it
                gets in the way. You cannot total a column, filter for a specific
                merchant, or import a printout into accounting software.
              </p>
              <p>
                With the data in CSV form, a TD statement becomes something you can
                actually analyse: reconcile a month in minutes, categorise spending for a
                budget, or hand a clean file to your bookkeeper. Pull several statements
                together and tax prep stops being a retyping exercise.
              </p>
              {/* TODO(launch-blocker): AI-assisted extraction and balance checks
                  mentioned here rely on the parser and validation pipeline, which
                  are not built yet. Verify before launch. */}
              <p>
                Parser-first extraction with guided AI verification helps untangle TD&apos;s
                multi-line entries, while balance checks compare the running total against the
                statement so you can review highlighted rows before you export. You review
                everything first, and we do not claim perfect accuracy.
              </p>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <p className="text-sm font-semibold text-slate-900">Example TD export</p>
            <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-50 p-4 text-xs text-slate-600">
{`Date,Description,Debit,Credit,Balance
2024-07-01,Balance Forward,,,980.00
2024-07-02,PRE-AUTH PAYMENT Hydro,124.00,,856.00
2024-07-04,e-Transfer Received,,300.00,1156.00`}
            </pre>
          </div>
        </div>
      </Section>

      <Section>
        <SectionHeading
          title="Common TD statement formatting issues"
          description="TD PDFs have their own habits. Here is how the converter is designed to deal with them, with a review step before export."
        />
        <div className="mt-12">
          <FeatureCards
            items={[
              {
                title: "Multi-line entries",
                body: "Pre-authorized payments and e-Transfers often carry extra detail lines. The parser is designed to fold them back into a single transaction.",
              },
              {
                title: "Debit and credit split",
                body: "TD lists money out and money in separately, and the CSV is designed to preserve that split rather than merge it.",
              },
              {
                title: "Headers and carried balances",
                body: "Statement headers and balance-forward lines are treated as context, not as spending.",
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
      <DataRetentionTrustBlock body="There is no TD account linking and no online banking password to hand over — you simply upload the statement PDF. Your statement is processed to create your spreadsheet file and is not sold or used for marketing or ads. When guided AI verification is used, it works from rendered statement images, not your original PDF." />

      <Section>
        <div className="mx-auto max-w-3xl">
          <SectionHeading title="TD conversion FAQ" centered />
          <div className="mt-10">
            <FAQSection items={tdFaqs} />
          </div>
          <p className="mt-6 text-center text-sm text-slate-600">
            Also have an RBC statement? See the{" "}
            <Link
              href="/convert-rbc-bank-statement-to-csv"
              className="font-medium text-brand-700 hover:underline"
            >
              RBC statement to CSV
            </Link>{" "}
            guide, or the general{" "}
            <Link
              href="/pdf-bank-statement-to-csv"
              className="font-medium text-brand-700 hover:underline"
            >
              PDF to CSV
            </Link>{" "}
            guide.
          </p>
        </div>
      </Section>

      <RelatedPagesLinks
        muted
        links={[
          { label: "Canadian bank statements", href: "/canadian-bank-statement-to-csv", description: "All bank guides and common formats." },
          { label: "RBC statements", href: "/convert-rbc-bank-statement-to-csv", description: "Designed for digital RBC PDFs." },
          { label: "PDF to CSV", href: "/pdf-bank-statement-to-csv", description: "The general conversion guide." },
          { label: "PDF to Excel", href: "/pdf-bank-statement-to-excel", description: "Open the data in Excel." },
          { label: "Security", href: "/security", description: "How your statement data is handled." },
          { label: "Sample output", href: "/sample", description: "See the cleaned data." },
        ]}
      />

      <CTASection
        title="Convert your TD statement now"
        description="Upload a PDF, review the transactions, and download a clean CSV."
      />
    </>
  );
}
