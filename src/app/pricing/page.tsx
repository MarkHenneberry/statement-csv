import type { Metadata } from "next";
import Link from "next/link";
import { Section, SectionHeading } from "@/components/Section";
import { PricingCards } from "@/components/PricingCards";
import { FAQSection } from "@/components/FAQSection";
import { CTASection } from "@/components/CTASection";
import { absoluteUrl } from "@/lib/site";
import { generalFaqs } from "@/lib/faq";
import { pricingHeadline, pricingSubheadline, pricingFooter } from "@/lib/pricing";

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
        <div className="mt-12">
          <PricingCards />
        </div>
        {/* TODO(launch-blocker): paid tiers require auth + payments + server-side
            page-quota enforcement (none built yet). Only the free preview is
            actually available today; the paid cards describe intended plans. */}
        <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-slate-500">
          {pricingFooter}
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
        description="Preview up to 5 pages to see how your statement converts before choosing a plan."
        primaryCta={{ label: "Convert a Statement", href: "/upload" }}
        secondaryCta={{ label: "Read the FAQ", href: "/faq" }}
      />
    </>
  );
}
