import { Section, SectionHeading } from "@/components/Section";

// "Built for bank statements, not generic PDFs" positioning block. Pages can
// override the body so wording differs and content is not duplicated verbatim.
export function BuiltForBankStatementsBlock({
  muted = false,
  heading = "Built for Canadian bank statements, not generic PDFs",
  body = "Generic PDF converters try to pull tables out of any document. StatementCSV is parser-first and designed around Canadian bank statement data: transaction rows, Interac e-Transfers, repeated page headers, debit and credit columns, running balances, multi-page statements, and review warnings. The goal is not just to copy text out of a PDF. It is to create a spreadsheet-ready transaction file you can trust enough to review and export.",
  centered = true,
}: {
  muted?: boolean;
  heading?: string;
  body?: string;
  /** Center the heading and intro text. Centered by default for a consistent
   *  site-wide section alignment; pass false for a left-aligned variant. */
  centered?: boolean;
}) {
  return (
    <Section muted={muted}>
      <div className={`mx-auto max-w-3xl ${centered ? "text-center" : ""}`}>
        <SectionHeading eyebrow="Bank statements, specifically" title={heading} centered={centered} />
        <p className="mt-4 text-base leading-relaxed text-slate-600 sm:text-lg">{body}</p>
      </div>
    </Section>
  );
}
