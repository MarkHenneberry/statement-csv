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

const path = "/compare-bank-statement-converters";

export const metadata: Metadata = {
  title: "Compare Bank Statement Converters",
  description:
    "Features to consider when choosing a bank statement converter: balance checks, review workflow, CSV/Excel export, Canadian statement support, scanned vs digital PDFs, and transparent pricing.",
  alternates: { canonical: absoluteUrl(path) },
};

const crumbs = [
  { name: "Home", path: "/" },
  { name: "Compare bank statement converters", path },
];

const faqs: FaqItem[] = [
  {
    question: "What should I look for in a bank statement converter?",
    answer:
      "Consider how it verifies accuracy (balance checks), whether you can review and edit rows before export, the export formats (CSV and Excel), how it handles digital vs scanned PDFs, statement-format support for your region, and pricing transparency.",
  },
  {
    question: "Do bank statement converters work with scanned PDFs?",
    answer:
      "It varies by tool. StatementCSV works best with digital, text-based PDFs where the transaction text is selectable; scanned support is not available yet. Check each option for its scanned-PDF behavior.",
  },
  {
    question: "How is StatementCSV different?",
    answer:
      "StatementCSV uses parser-first extraction with guided AI verification, balance-checks the result against statement totals, and highlights uncertain rows for review before export. It is designed for common Canadian bank and credit-card statement formats and exports clean CSV or Excel.",
  },
];

export default function CompareConvertersPage() {
  return (
    <>
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
      <JsonLd data={faqPageJsonLd(faqs)} />

      <Section>
        <Breadcrumbs crumbs={crumbs} />
        <div className="max-w-3xl">
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            Compare Bank Statement Converters
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-slate-600">
            There are several ways to turn a PDF bank statement into a spreadsheet. Rather than make
            claims about specific competitors, here are the features to consider when choosing a bank
            statement converter — and how StatementCSV approaches each one.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <ButtonLink href="/upload">Convert a statement</ButtonLink>
            <ButtonLink href="/sample" variant="secondary">
              See sample export
            </ButtonLink>
          </div>
        </div>
      </Section>

      <Section muted>
        <SectionHeading
          title="Features to consider when choosing a converter"
          description="Weigh these categories against any options you are evaluating, including alternatives like DocuClipper, MoneyThumb, or PDFTables."
        />
        <div className="mt-12">
          <FeatureCards
            items={[
              {
                title: "Balance checks",
                body: "Does it compare extracted totals against the statement's opening and closing balances? StatementCSV does this and never presents a balance gap as verified.",
              },
              {
                title: "Review / highlight workflow",
                body: "Can you review and edit rows before export? StatementCSV highlights uncertain rows so you check them first.",
              },
              {
                title: "CSV & Excel export",
                body: "Does it export clean CSV and Excel? StatementCSV exports both with consistent Date, Description, Debit, Credit, Amount, and Balance columns.",
              },
              {
                title: "Canadian statement support",
                body: "Is it designed for your region's formats? StatementCSV targets common Canadian bank and credit-card statement layouts, including Interac e-Transfers.",
              },
              {
                title: "Scanned vs digital PDFs",
                body: "Check how each tool handles scanned files. StatementCSV works best with digital, text-based PDFs; scanned support is not available yet.",
              },
              {
                title: "Transparent pricing",
                body: "Look for clear, page-based pricing without surprises. StatementCSV lists simple monthly plans and a free preview.",
              },
            ]}
            columns={3}
          />
        </div>
      </Section>

      <Section>
        <div className="mx-auto max-w-3xl space-y-4 text-base leading-relaxed text-slate-600">
          <SectionHeading title="How to evaluate options honestly" />
          <p>
            The best way to compare converters is to run your own statements through each one and
            check the results: did the rows reconcile, were descriptions readable, and did debit and
            credit amounts land in the right columns? Features and pricing change over time, so verify
            current details on each provider&apos;s own site before deciding.
          </p>
          <p>
            StatementCSV&apos;s approach is parser-first extraction with guided AI verification plus
            balance checks, with a review step before export — see the{" "}
            <Link href="/sample" className="font-medium text-brand-700 hover:underline">
              sample export
            </Link>{" "}
            to judge the output for yourself.
          </p>
        </div>
      </Section>

      <Section muted>
        <div className="mx-auto max-w-3xl">
          <SectionHeading title="Comparison FAQ" centered />
          <div className="mt-10">
            <FAQSection items={faqs} />
          </div>
        </div>
      </Section>

      <RelatedPagesLinks
        links={[
          { label: "Bank statement to CSV", href: "/bank-statement-to-csv", description: "The main conversion page." },
          { label: "Canadian bank statement to CSV", href: "/canadian-bank-statement-to-csv", description: "Common Canadian formats." },
          { label: "How to convert a PDF to CSV", href: "/help/how-to-convert-bank-statement-pdf-to-csv", description: "Step-by-step help guide." },
          { label: "Pricing", href: "/pricing", description: "Simple, page-based plans." },
          { label: "Security", href: "/security", description: "How your statement data is handled." },
          { label: "Sample output", href: "/sample", description: "See the cleaned data first." },
        ]}
      />

      <CTASection
        title="Try StatementCSV on your statement"
        description="Upload a PDF, review the highlighted rows, and download a clean CSV or Excel file."
      />
    </>
  );
}
