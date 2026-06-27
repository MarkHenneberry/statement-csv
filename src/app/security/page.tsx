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

function VerifyBeforeLaunch() {
  const items = [
    "Temporary file deletion",
    "Parser output deletion",
    "Production logging policy",
    "No statement data in logs",
    "No transaction descriptions in logs",
    "No account numbers in logs",
    "No stored extracted rows",
    "Third-party AI provider disclosure (guided AI verification sends rendered statement images to an external AI service)",
    "Privacy policy review before public launch",
  ];
  return (
    <ul className="mt-8 grid gap-3 sm:grid-cols-2">
      {items.map((item) => (
        <li key={item} className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <svg className="mt-0.5 h-4 w-4 flex-none text-amber-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 6a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 6Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
          </svg>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export default function SecurityPage() {
  return (
    <>
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
      <JsonLd data={faqPageJsonLd(faqs)} />

      <Section>
        <Breadcrumbs crumbs={crumbs} />
        <div className="max-w-3xl">
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            Security and Privacy for Bank Statement Conversion
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-slate-600">
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
          {/*
            TODO(launch-blocker): The handling described here is the intended
            design. Before launch we must implement and VERIFY in production:
            temporary file deletion, parser output deletion, no statement content
            (descriptions, balances, account numbers, rows) in logs, and a
            finalized production logging policy.
          */}
          <div className="mt-6 space-y-4 text-base leading-relaxed text-slate-700">
            <p>
              You upload a PDF statement, the converter extracts the transaction rows, and
              you review them in your browser before exporting a CSV. There is no bank
              login and no link to your account, so there is no standing connection for
              anyone to misuse.
            </p>
            <p>
              Your statement is processed to create your spreadsheet file and is not sold
              or used for marketing or ads. We avoid using your original PDF directly as the
              AI input — when guided AI verification is used, it works from rendered
              statement images sent to a third-party AI provider, not your original PDF.
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
            title="What needs to be verified before launch"
            description="Being honest matters more than sounding polished. These items must be implemented and verified in the production parser pipeline before public launch."
          />
          <VerifyBeforeLaunch />
          <p className="mt-6 text-sm text-slate-500">
            We avoid absolute claims like &ldquo;zero data retention&rdquo; or
            &ldquo;encrypted and deleted instantly&rdquo; until they are implemented and
            verified. Where the backend is not finished, we say &ldquo;designed to.&rdquo;
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
