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
import { BankStatementTechnicalExplainer } from "@/components/content/BankStatementTechnicalExplainer";
import { BuiltForBankStatementsBlock } from "@/components/content/BuiltForBankStatementsBlock";
import { WhoUsesThisTool } from "@/components/content/WhoUsesThisTool";
import { DataRetentionTrustBlock } from "@/components/content/DataRetentionTrustBlock";
import { RelatedPagesLinks } from "@/components/content/RelatedPagesLinks";
import { absoluteUrl } from "@/lib/site";
import { generalFaqs } from "@/lib/faq";
import { breadcrumbJsonLd, faqPageJsonLd } from "@/lib/structured-data";

const path = "/bank-statement-parser";

export const metadata: Metadata = {
  title: "Bank Statement Parser for Clean Transaction Data",
  description:
    "A bank statement parser that extracts structured transaction rows from PDF statements — date, description, debit, credit, amount, and running balance — with row warnings and balance checks before you export to CSV or Excel.",
  alternates: { canonical: absoluteUrl(path) },
};

const crumbs = [
  { name: "Home", path: "/" },
  { name: "Bank statement parser", path },
];

const faqs = generalFaqs.filter((faq) =>
  [
    "What data is extracted from the bank statement?",
    "Is this different from a normal PDF to Excel converter?",
    "What are balance checks?",
    "What happens if a statement does not convert correctly?",
    "Does AI read my bank statement?",
    "Do you keep my bank statement data?",
  ].includes(faq.question),
);

export default function BankStatementParserPage() {
  return (
    <>
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
      <JsonLd data={faqPageJsonLd(faqs)} />

      <Section>
        <Breadcrumbs crumbs={crumbs} />
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-balance text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Bank Statement Parser for Clean Transaction Data
          </h1>
          <p className="mt-5 text-base leading-relaxed text-slate-600 sm:text-lg">
            This is a tool for extracting transaction data from PDF bank statements and
            turning it into a clean spreadsheet file for Excel, Google Sheets, bookkeeping,
            and accounting software.
          </p>
          <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
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
          description="The parser does the structuring; you stay in control of the final data."
        />
        <div className="mt-12">
          <HowItWorks
            steps={[
              {
                title: "Upload the PDF statement",
                body: "The parser reads a digital PDF and reconstructs the transaction lines.",
              },
              {
                title: "Review structured rows",
                body: "Edit any cell, see row warnings, and check the balance summary before export.",
              },
              {
                title: "Download CSV or Excel",
                body: "Export spreadsheet-ready transaction data for your accounting workflow.",
              },
            ]}
          />
        </div>
      </Section>

      <BankStatementTechnicalExplainer
        heading="What the parser extracts"
        intro="The parser is focused on bank statement structure: it turns each transaction line into a structured row of fields rather than a wall of copied text."
      />

      <Section muted>
        <SectionHeading
          title="Structured transaction rows"
          description="Date, description, debit, credit, amount, and balance — in dedicated fields."
        />
        <div className="mx-auto mt-10 max-w-4xl">
          <OutputColumnsExample
            title="Parser output"
            caption="The amount is calculated from debit/credit so the two never disagree."
          />
        </div>
      </Section>

      <Section>
        <SectionHeading
          title="Data validation and review warnings"
          description="The parser prefers honest warnings over guessing."
        />
        <ul className="mx-auto mt-8 max-w-3xl space-y-3 text-base text-slate-700">
          <li>Row warnings flag missing dates, missing descriptions, or unusual values.</li>
          <li>Low-confidence rows are highlighted so you know where to look.</li>
          <li>
            Balance checks compare totals against the statement&apos;s opening and closing
            balance to help catch a missing or misread transaction.
          </li>
          <li>You review and edit everything before export — we do not claim perfect accuracy.</li>
        </ul>
        {/* TODO(launch-blocker): the parser is an MVP prototype and has not been
            validated against a representative set of real statements. Parser
            accuracy testing is required before launch. */}
      </Section>

      <BuiltForBankStatementsBlock muted />

      <WhoUsesThisTool
        heading="Built for technical and business users"
        description="Useful whether you are reconciling books, preparing taxes, or just need statement data as structured rows."
      />

      <DataRetentionTrustBlock />

      <RelatedPagesLinks
        muted
        heading="Related pages"
        links={[
          { label: "PDF to CSV", href: "/pdf-bank-statement-to-csv", description: "Convert a statement to a clean CSV." },
          { label: "PDF to Excel", href: "/pdf-bank-statement-to-excel", description: "Open the data in Excel or Google Sheets." },
          { label: "Sample output", href: "/sample", description: "See the structured rows." },
          { label: "Security", href: "/security", description: "How statement data is handled." },
          { label: "RBC statements", href: "/convert-rbc-bank-statement-to-csv", description: "Designed for digital RBC PDFs." },
          { label: "TD statements", href: "/convert-td-bank-statement-to-csv", description: "Designed for digital TD PDFs." },
        ]}
      />

      <Section>
        <div className="mx-auto max-w-3xl">
          <SectionHeading title="Frequently asked questions" centered />
          <div className="mt-10">
            <FAQSection items={faqs} />
          </div>
          <p className="mt-6 text-center text-sm text-slate-600">
            New here? Start with the{" "}
            <Link href="/pdf-bank-statement-to-csv" className="font-medium text-brand-700 hover:underline">
              PDF to CSV
            </Link>{" "}
            guide.
          </p>
        </div>
      </Section>

      <CTASection
        title="Parse a statement into clean rows"
        description="Upload a PDF, review the structured transactions, and export to CSV or Excel."
        secondaryCta={{ label: "See sample output", href: "/sample" }}
      />
    </>
  );
}
