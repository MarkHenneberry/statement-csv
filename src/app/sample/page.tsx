import type { Metadata } from "next";
import Link from "next/link";
import { Section, SectionHeading } from "@/components/Section";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CTASection } from "@/components/CTASection";
import { ButtonLink } from "@/components/Button";
import { JsonLd } from "@/components/JsonLd";
import { OutputColumnsExample } from "@/components/content/OutputColumnsExample";
import { BuiltForBankStatementsBlock } from "@/components/content/BuiltForBankStatementsBlock";
import { PrivacyMiniBlock } from "@/components/content/PrivacyMiniBlock";
import { RelatedPagesLinks } from "@/components/content/RelatedPagesLinks";
import { absoluteUrl } from "@/lib/site";
import { breadcrumbJsonLd } from "@/lib/structured-data";

const path = "/sample";

export const metadata: Metadata = {
  title: "Sample Bank Statement CSV Output",
  description:
    "See a sample bank statement CSV example before you upload. View the cleaned columns — date, description, debit, credit, amount, and balance — that StatementCSV produces from a PDF statement.",
  alternates: { canonical: absoluteUrl(path) },
};

const crumbs = [
  { name: "Home", path: "/" },
  { name: "Sample output", path },
];

const columnNotes: { name: string; note: string }[] = [
  { name: "Date", note: "The transaction date, normalized to a consistent, sortable format." },
  { name: "Description", note: "The merchant or memo text, rejoined when it wraps across lines." },
  { name: "Debit", note: "Money out, kept in its own field." },
  { name: "Credit", note: "Money in, kept in its own field." },
  { name: "Amount", note: "Calculated from debit/credit so the two never disagree." },
  { name: "Balance", note: "The running balance, when the statement lists one per line." },
];

export default function SamplePage() {
  return (
    <>
      <JsonLd data={breadcrumbJsonLd(crumbs)} />

      <Section>
        <Breadcrumbs crumbs={crumbs} />
        <div className="max-w-3xl">
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            Sample Bank Statement CSV Output
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-slate-600">
            See what the cleaned data looks like before you upload a real statement. This
            is example data, not a real account.
          </p>
          <div className="mt-8">
            <ButtonLink href="/upload">Convert your own statement</ButtonLink>
          </div>
        </div>
      </Section>

      <Section muted>
        <SectionHeading
          title="The cleaned transaction table"
          description="Each transaction becomes a row with separate, spreadsheet-ready fields."
        />
        <div className="mx-auto mt-10 max-w-4xl">
          <OutputColumnsExample
            title="Sample output (example data)"
            caption="Example data for illustration — your real statement produces your own rows."
          />
        </div>
      </Section>

      <Section>
        <div className="mx-auto max-w-4xl">
          <SectionHeading
            title="The same data as raw CSV"
            description="This is exactly the kind of file you download and open in Excel or Google Sheets."
          />
          <pre className="mt-8 overflow-x-auto rounded-2xl border border-slate-200 bg-slate-50 p-5 text-xs leading-relaxed text-slate-700">
{`Date,Description,Debit,Credit,Amount,Balance
2024-05-02,Payroll Deposit,,2200.00,2200.00,4200.00
2024-05-03,Grocery Mart #214,84.20,,-84.20,4115.80
2024-05-05,Coffee Roasters,5.75,,-5.75,4110.05
2024-05-07,Hydro One Pre-Auth,142.50,,-142.50,3967.55
2024-05-09,e-Transfer Received,,300.00,300.00,4267.55`}
          </pre>
        </div>
      </Section>

      <Section muted>
        <div className="mx-auto max-w-3xl">
          <SectionHeading
            title="What each column means"
            description="The columns are designed around bank statement data, not generic tables."
          />
          <dl className="mt-8 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
            {columnNotes.map((c) => (
              <div key={c.name} className="flex flex-col gap-1 p-4 sm:flex-row sm:gap-6">
                <dt className="w-32 flex-none font-semibold text-slate-900">{c.name}</dt>
                <dd className="text-sm text-slate-600">{c.note}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-8">
            <PrivacyMiniBlock />
          </div>
        </div>
      </Section>

      <BuiltForBankStatementsBlock
        body="This sample shows the point of a dedicated bank statement converter: clean transaction rows with debits, credits, amounts, and balances in their own fields — not a rough copy-paste of a PDF. You review the data before exporting, and balance checks help catch a missing or misread transaction."
      />

      <RelatedPagesLinks
        muted
        links={[
          { label: "Convert a statement", href: "/upload", description: "Upload your own PDF and preview the result." },
          { label: "PDF to CSV", href: "/pdf-bank-statement-to-csv", description: "The full CSV walkthrough." },
          { label: "PDF to Excel", href: "/pdf-bank-statement-to-excel", description: "Open the data in Excel." },
          { label: "Bank statement parser", href: "/bank-statement-parser", description: "How extraction works." },
          { label: "Security", href: "/security", description: "How your data is handled." },
          { label: "Pricing", href: "/pricing", description: "Free preview, then page-based plans." },
        ]}
      />

      <CTASection
        title="Ready to see your own data?"
        description="Upload a PDF statement and preview the cleaned rows before you export."
        secondaryCta={{ label: "Read the FAQ", href: "/faq" }}
      />

      <Section>
        <p className="mx-auto max-w-3xl text-center text-sm text-slate-500">
          Looking for a specific bank? See the{" "}
          <Link href="/convert-rbc-bank-statement-to-csv" className="font-medium text-brand-700 hover:underline">
            RBC
          </Link>{" "}
          and{" "}
          <Link href="/convert-td-bank-statement-to-csv" className="font-medium text-brand-700 hover:underline">
            TD
          </Link>{" "}
          guides.
        </p>
      </Section>
    </>
  );
}
