import type { Metadata } from "next";
import Link from "next/link";
import { Section, SectionHeading } from "@/components/Section";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FAQSection } from "@/components/FAQSection";
import { CTASection } from "@/components/CTASection";
import { JsonLd } from "@/components/JsonLd";
import { DataRetentionTrustBlock } from "@/components/content/DataRetentionTrustBlock";
import { RelatedPagesLinks } from "@/components/content/RelatedPagesLinks";
import { absoluteUrl } from "@/lib/site";
import { generalFaqs } from "@/lib/faq";
import { breadcrumbJsonLd, faqPageJsonLd } from "@/lib/structured-data";

const path = "/security";

export const metadata: Metadata = {
  title: "Security and Privacy for Bank Statement Conversion",
  description:
    "A privacy-conscious bank statement converter: no bank login, no selling of transaction data, and no use of your statement data for marketing. Read how files are handled and what we still need to verify before launch.",
  alternates: { canonical: absoluteUrl(path) },
};

const crumbs = [
  { name: "Home", path: "/" },
  { name: "Security", path },
];

const faqs = generalFaqs.filter((faq) =>
  [
    "Is this safe for bank statements?",
    "Do you keep my bank statement data?",
    "Do you use my statement data for ads or training?",
    "Do I need to connect my bank account?",
  ].includes(faq.question),
);

function DoNotStore() {
  const items = [
    "We do not require bank login credentials.",
    "We do not connect to your bank account.",
    "We do not sell or share your transaction data.",
    "We do not use your statement data for ads or marketing.",
    "We avoid using your original PDF as the AI input — guided AI verification works from rendered statement images.",
    "We store account, billing, and quota metadata — not your transaction rows, descriptions, balances, or original PDF.",
    "Your PDF and extracted text are held in memory only during processing, not written to a database or file storage.",
    "Free-preview tracking stores only quota metadata and a hashed, anonymous preview identifier.",
    "Payments are handled by Stripe; we do not store card numbers.",
  ];
  return (
    <ul className="mt-8 space-y-3">
      {items.map((item) => (
        <li key={item} className="flex gap-3 text-base text-slate-700">
          <svg className="mt-1 h-5 w-5 flex-none text-emerald-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.5 7.6a1 1 0 0 1-1.43.005l-3.5-3.55a1 1 0 1 1 1.424-1.404l2.786 2.826 6.79-6.885a1 1 0 0 1 1.414-.006Z" clipRule="evenodd" />
          </svg>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function StoreCard({
  title,
  tone,
  items,
}: {
  title: string;
  tone: "store" | "no-store";
  items: string[];
}) {
  const isStore = tone === "store";
  const iconColor = isStore ? "text-brand-600" : "text-slate-400";
  return (
    <div className="rounded-xl border border-slate-200 bg-section p-6 shadow-card">
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      <ul className="mt-4 space-y-3">
        {items.map((item) => (
          <li key={item} className="flex gap-3 text-sm leading-relaxed text-slate-700">
            <svg className={`mt-0.5 h-5 w-5 flex-none ${iconColor}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              {isStore ? (
                <path fillRule="evenodd" d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.5 7.6a1 1 0 0 1-1.43.005l-3.5-3.55a1 1 0 1 1 1.424-1.404l2.786 2.826 6.79-6.885a1 1 0 0 1 1.414-.006Z" clipRule="evenodd" />
              ) : (
                <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM6.28 6.28a.75.75 0 0 1 1.06 0L10 8.94l2.66-2.66a.75.75 0 1 1 1.06 1.06L11.06 10l2.66 2.66a.75.75 0 1 1-1.06 1.06L10 11.06l-2.66 2.66a.75.75 0 0 1-1.06-1.06L8.94 10 6.28 7.34a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
              )}
            </svg>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function WhatWeStore() {
  const stored = [
    "Account and billing details — your email, plan, and subscription status.",
    "Conversion metadata — page count, conversion status, balance-check result, page credits used, and timestamps.",
    "Free-preview tracking — quota counts plus a hashed, anonymous preview identifier (not your statement).",
  ];
  const notStored = [
    "Your uploaded PDF files.",
    "Extracted PDF text, transaction rows, descriptions, or balances.",
    "Rendered statement images.",
    "Exported CSV or Excel files.",
    "AI prompts or AI responses.",
  ];
  return (
    <div className="mt-8 grid gap-4 sm:grid-cols-2">
      <StoreCard title="What we may store" tone="store" items={stored} />
      <StoreCard title="What we do not store" tone="no-store" items={notStored} />
    </div>
  );
}

export default function SecurityPage() {
  return (
    <>
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
      <JsonLd data={faqPageJsonLd(faqs)} />

      <Section>
        <Breadcrumbs crumbs={crumbs} />
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-balance text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Security and Privacy for Bank Statement Conversion
          </h1>
          <p className="mt-5 text-base leading-relaxed text-slate-600 sm:text-lg">
            Bank statements are sensitive. StatementCSV is designed to handle them with
            care: no bank login, no selling of transaction data, and no use of your
            statement data for marketing. Your statement is processed to create your
            spreadsheet file.
          </p>
          <p className="mt-4 text-sm font-medium text-slate-500">
            No bank login. Not used for marketing.
          </p>
        </div>
      </Section>

      <Section muted>
        <div className="mx-auto max-w-3xl">
          <SectionHeading
            title="How your file is handled"
            description="You work only from the PDF you already have — there is no connection to your bank."
          />
          <div className="mt-6 space-y-4 text-base leading-relaxed text-slate-700">
            <p>
              You upload a PDF statement, the converter extracts the transaction rows, and
              you review them in your browser before exporting a CSV. There is no bank
              login and no link to your account, so there is no standing connection for
              anyone to misuse.
            </p>
            <p>
              Your uploaded PDF and its extracted text are processed in memory during the
              conversion — they are not written to a database or file storage. Your statement
              is used to create your spreadsheet file and is not sold or used for marketing or
              ads. We avoid using your original PDF directly as the AI input — when guided AI
              verification is used, it works from rendered statement images sent to a
              third-party AI provider, not your original PDF.
            </p>
          </div>
        </div>
      </Section>

      <Section>
        <div className="mx-auto max-w-3xl">
          <SectionHeading title="Our data commitments" />
          <DoNotStore />
        </div>
      </Section>

      <Section muted>
        <div className="mx-auto max-w-3xl">
          <SectionHeading
            title="What StatementCSV stores — and what it doesn’t"
            description="Your statement is processed in memory during conversion. We keep the metadata needed to run your account and credits, not the contents of your statement."
          />
          <WhatWeStore />
          <p className="mt-6 text-sm leading-relaxed text-slate-600">
            Payments are handled by Stripe — card and payment details are entered on Stripe,
            and StatementCSV does not store card numbers. StatementCSV uses parser-first
            extraction; when a conversion needs verification, guided AI verification may send
            rendered statement images to an external AI provider. Conversions are balance-checked
            where possible, and rows that need a second look are highlighted — review highlighted
            rows before relying on an export.
          </p>
        </div>
      </Section>

      <DataRetentionTrustBlock />

      <Section>
        <div className="mx-auto max-w-3xl">
          <SectionHeading title="Security & privacy FAQ" centered />
          <div className="mt-10">
            <FAQSection items={faqs} />
          </div>
          <p className="mt-6 text-center text-sm text-slate-600">
            See the full{" "}
            <Link href="/privacy" className="font-medium text-brand-700 hover:underline">
              privacy page
            </Link>{" "}
            or the{" "}
            <Link href="/faq" className="font-medium text-brand-700 hover:underline">
              FAQ
            </Link>
            .
          </p>
        </div>
      </Section>

      <RelatedPagesLinks
        muted
        links={[
          { label: "Privacy", href: "/privacy", description: "How we handle your data." },
          { label: "PDF to CSV", href: "/pdf-bank-statement-to-csv", description: "Convert a statement to CSV." },
          { label: "Bank statement parser", href: "/bank-statement-parser", description: "How extraction works." },
          { label: "Sample output", href: "/sample", description: "See the cleaned data." },
          { label: "Pricing", href: "/pricing", description: "Free preview, then page-based plans." },
          { label: "FAQ", href: "/faq", description: "Common questions answered." },
        ]}
      />

      <CTASection
        title="Convert a statement, privately"
        description="No bank login, with balance checks to help you review before export."
      />
    </>
  );
}
