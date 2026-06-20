import type { Metadata } from "next";
import Link from "next/link";
import { Section, SectionHeading } from "@/components/Section";
import { PricingCards } from "@/components/PricingCards";
import { FAQSection } from "@/components/FAQSection";
import { CTASection } from "@/components/CTASection";
import { absoluteUrl } from "@/lib/site";
import { generalFaqs } from "@/lib/faq";
import { pricingNote } from "@/lib/pricing";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Affordable, page-based pricing for converting bank statements to CSV with balance checks. Free preview, then Starter at $5/month, Plus at $10/month, or Pro at $20/month.",
  alternates: {
    canonical: absoluteUrl("/pricing"),
  },
};

const pricingFaqs = generalFaqs.filter((faq) =>
  [
    "Is this free?",
    "What are balance checks?",
    "Are scanned statements supported?",
    "Why is there no ad-supported version?",
  ].includes(faq.question),
);

export default function PricingPage() {
  return (
    <>
      <Section>
        <SectionHeading
          eyebrow="Pricing"
          title="Affordable conversion with balance checks"
          description="Run a free preview first, then choose a monthly plan based on how many pages you convert. Every paid plan includes balance checks."
          centered
        />
        <div className="mt-12">
          <PricingCards />
        </div>
        {/* TODO(launch-blocker): pricingNote references OCR support for scanned/
            image-heavy statements, which is not implemented yet. Balance checks
            advertised on the plans above also depend on the unbuilt validation
            pipeline. Verify both before charging for these plans. */}
        <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-slate-500">
          Prices are in USD. {pricingNote}
        </p>
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
        description="Preview up to 3 pages to see how your statement converts before choosing a plan."
        primaryCta={{ label: "Convert a Statement", href: "/upload" }}
        secondaryCta={{ label: "Read the FAQ", href: "/faq" }}
      />
    </>
  );
}
