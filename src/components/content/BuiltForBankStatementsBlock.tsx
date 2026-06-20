import { Section, SectionHeading } from "@/components/Section";

// "Built for bank statements, not generic PDFs" positioning block. Pages can
// override the body so wording differs and content is not duplicated verbatim.
export function BuiltForBankStatementsBlock({
  muted = false,
  heading = "Built for bank statements, not generic PDFs",
  body = "Generic PDF converters try to pull tables out of any document. StatementCSV is designed around bank statement data: transaction rows, repeated page headers, debit and credit columns, running balances, multi-page statements, and review warnings. The goal is not just to copy text out of a PDF — it is to create a spreadsheet-ready transaction file.",
}: {
  muted?: boolean;
  heading?: string;
  body?: string;
}) {
  return (
    <Section muted={muted}>
      <div className="mx-auto max-w-3xl">
        <SectionHeading eyebrow="Bank statements, specifically" title={heading} />
        <p className="mt-6 text-lg leading-relaxed text-slate-600">{body}</p>
      </div>
    </Section>
  );
}
