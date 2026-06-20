import type { Metadata } from "next";
import Link from "next/link";
import { Section, SectionHeading } from "@/components/Section";
import { CTASection } from "@/components/CTASection";
import { absoluteUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "How StatementCSV handles your data: no bank login, no ads, no stored statement data, and no selling or ad-targeting of your transaction data. We do not keep your bank statement data.",
  alternates: {
    canonical: absoluteUrl("/privacy"),
  },
};

export default function PrivacyPage() {
  return (
    <>
      <Section>
        <div className="mx-auto max-w-3xl">
          <SectionHeading
            eyebrow="Privacy"
            title="Private by design"
            description="Bank statements are sensitive. Our approach is to collect as little as possible and keep nothing we do not need."
          />

          {/*
            TODO(launch-blocker): The deletion commitments below are product
            intent. The deletion pipeline is NOT implemented yet. Before launch
            we must build and VERIFY automatic deletion of uploaded PDFs after
            conversion, and confirm this copy matches actual behavior.
          */}

          <div className="mt-10 space-y-8 text-base leading-relaxed text-slate-700">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
              <h2 className="text-xl font-semibold text-slate-900">
                We do not keep your bank statement data
              </h2>
              <p className="mt-3">
                Your bank statement is used only to create your spreadsheet file. We do not
                keep your statement, store your extracted transactions for marketing, sell
                your data, or use your financial information for ads.
              </p>
              <p className="mt-3 text-sm font-medium text-slate-500">
                No bank login. No ads. No stored statement data.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold text-slate-900">
                You do not connect your bank account
              </h2>
              <p className="mt-3">
                You never share online banking credentials and you never link an account.
                You only upload the PDF statement you want converted. That means there is
                no standing connection to your bank for anyone to misuse.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold text-slate-900">
                Designed so files are not kept after conversion
              </h2>
              <p className="mt-3">
                StatementCSV is designed so your statement is used only to create your
                spreadsheet file and is not kept afterward. This deletion behavior, and a
                production logging policy that excludes statement contents, must be verified
                in the production parser pipeline before launch. See the{" "}
                <Link href="/security" className="font-medium text-brand-700 hover:underline">
                  security page
                </Link>{" "}
                for the full checklist.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold text-slate-900">
                We do not sell or profile your data
              </h2>
              <p className="mt-3">
                We do not sell your transaction data, use it for ads, or keep financial
                records for marketing. Because we charge a small fee for conversions, we
                never need to monetize the contents of your statements.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold text-slate-900">No ads</h2>
              <p className="mt-3">
                The site is not ad-supported. An ad-supported model creates an incentive
                to track and profile users, which is the opposite of what a tool handling
                financial documents should do.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
              <p className="text-sm text-slate-600">
                This page describes how StatementCSV is intended to work. It is not legal
                advice and will be expanded with a formal privacy policy before launch.
                Questions about your data? Reach out through the{" "}
                <Link href="/faq" className="font-medium text-brand-700 hover:underline">
                  FAQ
                </Link>
                .
              </p>
            </div>
          </div>
        </div>
      </Section>

      <CTASection
        title="Convert a statement, privately"
        description="No bank login, no ads, and balance checks on every conversion."
      />
    </>
  );
}
