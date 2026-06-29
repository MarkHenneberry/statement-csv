import type { Metadata } from "next";
import Link from "next/link";
import { Hero } from "@/components/Hero";
import { Section, SectionHeading } from "@/components/Section";
import { HowItWorks } from "@/components/HowItWorks";
import { FeatureCards } from "@/components/FeatureCards";
import { PricingCards } from "@/components/PricingCards";
import { FAQSection } from "@/components/FAQSection";
import { CTASection } from "@/components/CTASection";
import { JsonLd } from "@/components/JsonLd";
import { ButtonLink } from "@/components/Button";
import { OutputColumnsExample } from "@/components/content/OutputColumnsExample";
import { BuiltForBankStatementsBlock } from "@/components/content/BuiltForBankStatementsBlock";
import { DataRetentionTrustBlock } from "@/components/content/DataRetentionTrustBlock";
import { RelatedPagesLinks } from "@/components/content/RelatedPagesLinks";
import { homeFaqs } from "@/lib/faq";
import { pricingFooter } from "@/lib/pricing";
import { absoluteUrl } from "@/lib/site";
import {
  softwareApplicationJsonLd,
  faqPageJsonLd,
} from "@/lib/structured-data";

export const metadata: Metadata = {
  title: "Convert Bank Statements to CSV & Excel",
  description:
    "Convert bank and credit-card statement PDFs into clean CSV or Excel exports. StatementCSV uses parser-first extraction, guided AI verification, and balance checks for bookkeeping-ready spreadsheets.",
  alternates: {
    canonical: absoluteUrl("/"),
  },
};

const csvIncludes = [
  {
    title: "Transaction date",
    body: "Each row keeps the posting or transaction date in a consistent, sortable format.",
  },
  {
    title: "Description",
    body: "The merchant or transaction description as it appears on your statement.",
  },
  {
    title: "Amount",
    body: "Debit and credit amounts, with separate columns or a signed amount where the statement allows.",
  },
  {
    title: "Running balance",
    body: "When your statement lists a balance per line, it is carried into the CSV.",
  },
];

const supportedTypes = [
  {
    title: "Chequing & savings",
    body: "Everyday Canadian account statements with dated debits, credits, Interac e-Transfers, fees, and running balances.",
  },
  {
    title: "Credit card statements",
    body: "Monthly Canadian card statements with purchases, payments, fees, and interest.",
  },
  {
    title: "Bank-specific guides",
    body: "Step-by-step pages for popular Canadian banks, with more on the way.",
  },
];

export default function HomePage() {
  return (
    <>
      <JsonLd data={softwareApplicationJsonLd()} />
      <JsonLd data={faqPageJsonLd(homeFaqs)} />

      <Hero
        title="Convert Bank Statement PDFs to CSV and Excel"
        primaryCta={{ label: "Convert a statement", href: "/upload" }}
        secondaryCta={{ label: "See sample export", href: "/sample" }}
      >
        <p>
          Upload a bank or credit-card statement PDF and export clean, balance-checked CSV
          or Excel files for bookkeeping, accounting, and spreadsheet review.
        </p>
        <p>
          StatementCSV uses parser-first extraction with guided AI verification to turn PDF
          statements into structured rows you can review, edit, and export.
        </p>
        <p className="font-medium text-slate-700">
          Built for common Canadian bank and credit-card statement formats. No bank login.
          Balance checks before export.
        </p>
      </Hero>

      <Section>
        <SectionHeading
          eyebrow="PDF bank statement to CSV"
          title="Turn bank statement PDFs into clean spreadsheet rows"
          description="Upload a bank or credit-card statement PDF and convert it into a clean table of transactions with Date, Description, Debit, Credit, Amount, and Balance. Export the result as CSV or Excel. It is built for bank statements, not generic PDFs, so it focuses on transaction rows — including common Canadian patterns like Interac e-Transfers."
          centered
        />
        <div className="mx-auto mt-10 max-w-4xl">
          <OutputColumnsExample
            title="From PDF statement to clean rows"
            caption="Review and edit the rows before you export to CSV or Excel."
          />
        </div>
      </Section>

      <Section muted>
        <SectionHeading
          eyebrow="How it works"
          title="Three steps from PDF to spreadsheet"
          description="No software to install and no bank connection. Upload a PDF, review the extracted rows, and export to CSV or Excel."
          centered
        />
        <div className="mt-12">
          <HowItWorks />
        </div>
      </Section>

      <Section>
        {/* TODO(launch-blocker): balance checks and the deletion/logging guarantees
            referenced across the site depend on the production pipeline being fully
            verified. Confirm before launch. */}
        <SectionHeading
          eyebrow="How the conversion works"
          title="Parser-first extraction with guided AI verification"
          description="A dedicated statement parser reads the layout and pulls transactions into clean columns. Guided AI verification works from rendered statement evidence to help structure harder layouts, and balance checks compare the result against the statement totals before you export."
          centered
        />
        <div className="mt-12">
          <FeatureCards
            items={[
              {
                title: "Balance-checked exports",
                body: "Extracted rows are checked against the statement's opening and closing balances where possible, so a balance gap is never presented as a verified conversion.",
              },
              {
                title: "Guided AI verification",
                body: "Parser-first extraction with guided AI verification works from rendered statement evidence to structure the rows, and the result is re-checked against the balances.",
              },
              {
                title: "Review highlighted rows",
                body: "Uncertain rows are highlighted before export. If a balance gap remains, you review and edit the rows instead of receiving a falsely balanced result.",
              },
            ]}
            columns={3}
          />
        </div>
      </Section>

      <Section muted>
        <SectionHeading
          eyebrow="What your CSV includes"
          title="Clean, structured transaction data"
          description="Each statement is turned into tidy rows and columns you can sort, filter, and total."
          centered
        />
        <div className="mt-12">
          <FeatureCards items={csvIncludes} columns={4} />
        </div>
      </Section>

      <Section>
        <div className="grid items-start gap-8 lg:grid-cols-2">
          <div>
            <SectionHeading
              eyebrow="Why not just copy and paste?"
              title="PDFs were not built for spreadsheets"
              centered={false}
            />
            <div className="mt-6 space-y-4 text-base leading-relaxed text-slate-600">
              <p>
                Copying transactions out of a PDF usually breaks the columns. Dates,
                descriptions, and amounts run together, multi-line descriptions split
                across rows, and negative numbers lose their sign.
              </p>
              <p>
                Cleaning that up by hand for a single month is tedious. Doing it for a
                full year of statements is a real time sink and an easy place to make
                mistakes.
              </p>
              <p>
                StatementCSV reads the layout for you and outputs consistent rows, so the
                file is ready to use the moment you download it.
              </p>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-section p-6 shadow-card">
            <p className="text-sm font-semibold text-slate-900">Before: pasted from PDF</p>
            <pre className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-surface p-4 text-xs text-slate-600">
{`03/04 GROCERY
STORE #221 -84.20 1,240.10
03/05 PAYROLL
DEPOSIT 2,000.00 3,240.10`}
            </pre>
            <p className="mt-6 text-sm font-semibold text-slate-900">After: clean CSV</p>
            <pre className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-surface p-4 text-xs text-slate-600">
{`Date,Description,Amount,Balance
2024-03-04,Grocery Store #221,-84.20,1240.10
2024-03-05,Payroll Deposit,2000.00,3240.10`}
            </pre>
          </div>
        </div>
      </Section>

      <BuiltForBankStatementsBlock muted centered />

      <DataRetentionTrustBlock />

      <Section muted>
        <SectionHeading
          eyebrow="Simple pricing"
          title="Affordable, page-based plans"
          description="Start with a free preview, then choose a monthly plan that fits how many pages you convert."
          centered
        />
        <div className="mt-12">
          <PricingCards />
        </div>
        <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-slate-500">
          {pricingFooter}
        </p>
        <div className="mt-8 text-center">
          <ButtonLink href="/pricing" variant="secondary">
            See full pricing
          </ButtonLink>
        </div>
      </Section>

      <Section>
        <SectionHeading
          eyebrow="Supported statement types"
          title="Built for Canadian statements first"
          description="Designed for RBC, TD, BMO, CIBC, Scotiabank, credit unions, and more. It supports common Canadian bank and credit-card statement patterns and works best with digital, text-based PDFs where the transaction text is selectable. When a statement needs review, we show it clearly before export."
          centered
        />
        <div className="mt-12">
          <FeatureCards items={supportedTypes} columns={3} />
        </div>
        <p className="mt-8 text-sm text-slate-600">
          Looking for your bank? See our guides for{" "}
          <Link href="/convert-rbc-bank-statement-to-csv" className="font-medium text-brand-700 hover:underline">
            RBC
          </Link>{" "}
          and{" "}
          <Link href="/convert-td-bank-statement-to-csv" className="font-medium text-brand-700 hover:underline">
            TD
          </Link>
          , or the general{" "}
          <Link href="/pdf-bank-statement-to-csv" className="font-medium text-brand-700 hover:underline">
            PDF bank statement to CSV
          </Link>{" "}
          guide.
        </p>
      </Section>

      <Section muted>
        <SectionHeading
          eyebrow="FAQ"
          title="Common questions"
          description="More detail on how conversions, privacy, and pricing work."
          centered
        />
        <div className="mx-auto mt-12 max-w-3xl">
          <FAQSection items={homeFaqs} />
          <p className="mt-6 text-center text-sm text-slate-600">
            See all questions on the{" "}
            <Link href="/faq" className="font-medium text-brand-700 hover:underline">
              FAQ page
            </Link>
            .
          </p>
        </div>
      </Section>

      <RelatedPagesLinks
        heading="Explore StatementCSV"
        links={[
          { label: "Bank statement to CSV", href: "/bank-statement-to-csv", description: "Convert bank and credit-card PDFs to CSV or Excel." },
          { label: "Canadian bank statement to CSV", href: "/canadian-bank-statement-to-csv", description: "Built for common Canadian statement formats." },
          { label: "RBC statement to CSV", href: "/convert-rbc-bank-statement-to-csv", description: "Convert RBC bank and card statement PDFs." },
          { label: "How to convert a PDF to CSV", href: "/help/how-to-convert-bank-statement-pdf-to-csv", description: "Step-by-step help guide." },
          { label: "Import into QuickBooks", href: "/blog/import-bank-statements-quickbooks", description: "Prepare a CSV for QuickBooks import." },
          { label: "PDF to Excel", href: "/pdf-bank-statement-to-excel", description: "Open your transactions in Excel or Google Sheets." },
        ]}
      />

      <CTASection />
    </>
  );
}
