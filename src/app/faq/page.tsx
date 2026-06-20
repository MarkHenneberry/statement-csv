import type { Metadata } from "next";
import Link from "next/link";
import { Section, SectionHeading } from "@/components/Section";
import { FAQSection } from "@/components/FAQSection";
import { CTASection } from "@/components/CTASection";
import { JsonLd } from "@/components/JsonLd";
import { generalFaqs } from "@/lib/faq";
import { absoluteUrl } from "@/lib/site";
import { faqPageJsonLd } from "@/lib/structured-data";

export const metadata: Metadata = {
  title: "FAQ",
  description:
    "Answers about converting bank statements to CSV and Excel: what data is extracted, how it differs from a generic PDF converter, balance checks, scanned statements, bookkeeping, QuickBooks and Xero, safety, and whether we keep your statement data.",
  alternates: {
    canonical: absoluteUrl("/faq"),
  },
};

export default function FaqPage() {
  return (
    <>
      <JsonLd data={faqPageJsonLd(generalFaqs)} />

      <Section>
        <SectionHeading
          eyebrow="FAQ"
          title="Frequently asked questions"
          description="Everything about how StatementCSV converts your statements, keeps your data private, and what it costs."
          centered
        />
        <div className="mx-auto mt-12 max-w-3xl">
          <FAQSection items={generalFaqs} />
          <p className="mt-8 text-center text-sm text-slate-600">
            Still have a question about your bank? See the guides for{" "}
            <Link
              href="/convert-rbc-bank-statement-to-csv"
              className="font-medium text-brand-700 hover:underline"
            >
              RBC
            </Link>{" "}
            and{" "}
            <Link
              href="/convert-td-bank-statement-to-csv"
              className="font-medium text-brand-700 hover:underline"
            >
              TD
            </Link>
            .
          </p>
        </div>
      </Section>

      <CTASection />
    </>
  );
}
