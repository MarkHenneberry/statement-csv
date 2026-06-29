import type { Metadata } from "next";
import Link from "next/link";
import { Section, SectionHeading } from "@/components/Section";
import { CTASection } from "@/components/CTASection";
import { absoluteUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "How StatementCSV handles your data: no bank login, and no selling or ad-targeting of your transaction data. Your statement is processed to create your conversion; retention and deletion behavior is being finalized before launch.",
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
            <div className="rounded-xl border border-slate-200 bg-section p-6 shadow-card">
              <h2 className="text-xl font-semibold text-slate-900">
                Your statement is used only to create your conversion
              </h2>
              <p className="mt-3">
                Your statement is processed to create your spreadsheet file and is not sold
                or used for marketing or ads. A formal retention and deletion guarantee is
                being finalized and must be verified before launch.
              </p>
              <p className="mt-3 text-sm font-medium text-slate-500">
                No bank login. Not used for marketing.
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
                What we store, and what we do not
              </h2>
              <p className="mt-3">
                Your uploaded PDF and its extracted text are held only in memory while your
                request is being processed; they are not written to a database or file
                storage. What we keep is account, billing, and quota metadata — for example
                the page count, conversion status, balance-check result, credits used, and
                timestamps. We do not store the contents of your transaction rows, merchant
                or description text, balances, or your original PDF. Free-preview tracking
                stores only quota metadata and a hashed, anonymous preview identifier — not
                your statement. A production logging policy that excludes statement contents
                is still being verified before launch. See the{" "}
                <Link href="/security" className="font-medium text-brand-700 hover:underline">
                  security page
                </Link>{" "}
                for the full checklist.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold text-slate-900">
                Payments are handled by Stripe
              </h2>
              <p className="mt-3">
                Subscriptions and payments are processed by Stripe. Card numbers and payment
                details are entered on Stripe and are never stored by StatementCSV — we keep
                only the plan and billing status needed to apply your page credits. Failed
                conversions do not use paid page credits.
              </p>
            </div>

            <div>
              <h2 className="text-xl font-semibold text-slate-900">
                How guided AI verification handles your statement
              </h2>
              <p className="mt-3">
                StatementCSV is parser-first. We avoid using your original PDF directly as
                the AI input — when guided AI verification is used, it works from rendered
                statement images. Those images are sent to a third-party AI provider to help
                structure the conversion, and the result is balance-checked before you
                review it. We do not claim AI never receives your statement contents; it
                receives rendered statement images, not your original PDF.
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

            <div className="rounded-xl border border-slate-200 bg-section p-6 shadow-card">
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
        description="No bank login, with balance checks on every conversion."
      />
    </>
  );
}
