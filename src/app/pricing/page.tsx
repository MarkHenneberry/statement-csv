import type { Metadata } from "next";
import Link from "next/link";
import { Section, SectionHeading } from "@/components/Section";
import { PricingCards } from "@/components/PricingCards";
import { FAQSection } from "@/components/FAQSection";
import { CTASection } from "@/components/CTASection";
import { absoluteUrl } from "@/lib/site";
import { generalFaqs } from "@/lib/faq";
import {
  pricingHeadline,
  pricingSubheadline,
  pricingFooter,
  freePreview,
  creditRules,
} from "@/lib/pricing";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Monthly page-credit pricing for converting Canadian bank and credit card statements to CSV and Excel, with parser-first extraction, guided AI verification, and balance checks. Free preview, then Minimum at $10/month, Plus at $25/month, Pro at $40/month, or Pro+ from $60/month.",
  alternates: {
    canonical: absoluteUrl("/pricing"),
  },
};

const pricingFaqs = generalFaqs.filter((faq) =>
  [
    "Is this free?",
    "What counts as a page?",
    "Do failed conversions use credits?",
    "Can I process more than 3,000 pages?",
    "What are balance checks?",
    "Are scanned statements supported?",
  ].includes(faq.question),
);

export default function PricingPage() {
  return (
    <>
      <Section>
        <SectionHeading
          eyebrow="Pricing"
          title={pricingHeadline}
          description={pricingSubheadline}
          centered
        />
        {/* Free preview callout: try before paying, no bank login. */}
        <div className="mx-auto mt-8 max-w-2xl rounded-xl border border-slate-200 bg-section p-4 text-center text-sm leading-relaxed text-slate-600 shadow-card">
          <span className="font-semibold text-slate-900">{freePreview.name}:</span>{" "}
          {freePreview.description}{" "}
          <Link href={freePreview.cta.href} className="font-medium text-brand-700 hover:underline">
            {freePreview.cta.label}
          </Link>
        </div>

        <div className="mt-10">
          <PricingCards />
        </div>
        <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-slate-500">
          {pricingFooter}
        </p>

        <div className="mx-auto mt-10 max-w-2xl rounded-xl border border-slate-200 bg-section p-6 shadow-card">
          <h3 className="text-center text-base font-semibold text-slate-900">
            How page credits work
          </h3>
          <ul className="mx-auto mt-4 max-w-md space-y-2 text-left text-sm text-slate-600">
            {creditRules.map((rule) => (
              <li key={rule} className="flex gap-2">
                <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-brand-500" />
                <span>{rule}</span>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <Section muted>
        <div className="mx-auto max-w-3xl">
          <SectionHeading title="Pricing questions" centered />
          <div className="mt-10">
            <FAQSection items={pricingFaqs} />
          </div>
          <p className="mt-6 text-center text-sm text-slate-600">
            Have another question? Visit the{" "}
            <Link href="/faq" className="font-medium text-brand-700 hover:underline">
              full FAQ
            </Link>{" "}
            or read about{" "}
            <Link href="/privacy" className="font-medium text-brand-700 hover:underline">
              how we handle your data
            </Link>
            .
          </p>
        </div>
      </Section>

      <CTASection
        title="Preview your statement free"
        description="Convert up to 6 pages every 12 hours to see how your statement converts before choosing a plan."
        primaryCta={{ label: "Convert a statement", href: "/upload" }}
        secondaryCta={{ label: "Read the FAQ", href: "/faq" }}
      />
    </>
  );
}
