import type { Metadata } from "next";
import Link from "next/link";
import { Section, SectionHeading } from "@/components/Section";
import { parserSamples } from "@/lib/parser-samples";

// Developer-only page. Never indexed. It is a static checklist — it stores
// nothing and submits nothing.
export const metadata: Metadata = {
  title: "Parser testing (dev)",
  description: "Developer-only manual testing checklist for the statement parser.",
  robots: { index: false, follow: false },
};

const safetyRules = [
  "Use only local development (npm run dev). Do not deploy this workflow.",
  "Do not upload real bank statements to third-party chats or AI tools.",
  "Use digital PDFs downloaded directly from the bank (not scans or photos).",
  "Test at least RBC, TD, Scotiabank, CIBC, and BMO if you have access.",
  "Nothing here is stored — results live only on your screen.",
];

const perPdfChecks = [
  "Did the parser find the right number of pages?",
  "Did it find transaction rows?",
  "Are the dates correct?",
  "Are debits and credits in the right columns?",
  "Are running balances correct where available?",
  "Did opening and closing balance detect?",
  "Did the balance check pass?",
  "Are low-confidence rows actually the rows that need review?",
  "Is the exported CSV usable in Excel / Google Sheets?",
];

const scorecardColumns = [
  "Bank / source",
  "Statement type",
  "Pages",
  "Rows expected",
  "Rows detected",
  "Major issues",
  "Balance status",
  "Usable CSV? (y/n)",
  "Notes",
];

export default function ParserTestingPage() {
  return (
    <>
      <Section>
        <div className="max-w-3xl">
          <span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
            Development only · noindex
          </span>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Parser testing checklist
          </h1>
          <p className="mt-4 text-base leading-relaxed text-slate-600">
            A manual checklist for testing the real parser prototype against local digital
            PDF bank statements. The parser is an unvalidated MVP — this page is for
            developer testing, not a public accuracy claim. Run a statement through{" "}
            <Link href="/upload" className="font-medium text-brand-700 hover:underline">
              /upload
            </Link>{" "}
            and read the dev diagnostics panel in the preview.
          </p>
        </div>
      </Section>

      <Section muted>
        <div className="mx-auto max-w-3xl">
          <SectionHeading title="Test safely" />
          <ul className="mt-6 space-y-3">
            {safetyRules.map((rule) => (
              <li key={rule} className="flex gap-3 text-base text-slate-700">
                <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-brand-500" />
                <span>{rule}</span>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <Section>
        <div className="mx-auto max-w-3xl">
          <SectionHeading
            title="For each PDF, check"
            description="Compare what you see in the preview and the dev diagnostics panel."
          />
          <ol className="mt-6 space-y-3">
            {perPdfChecks.map((check, i) => (
              <li key={check} className="flex gap-3 text-base text-slate-700">
                <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                  {i + 1}
                </span>
                <span>{check}</span>
              </li>
            ))}
          </ol>
        </div>
      </Section>

      <Section muted>
        <div className="mx-auto max-w-5xl">
          <SectionHeading
            title="Manual scorecard"
            description="Copy this into your own notes — nothing is saved here."
          />
          <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  {scorecardColumns.map((col) => (
                    <th key={col} className="px-3 py-2 font-medium">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[0, 1, 2].map((row) => (
                  <tr key={row}>
                    {scorecardColumns.map((col) => (
                      <td key={col} className="px-3 py-4 text-slate-300">
                        &mdash;
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Section>

      <Section>
        <div className="mx-auto max-w-3xl">
          <SectionHeading
            title="Synthetic samples"
            description="Fake, in-code samples for validating parser helpers without any real statement. Run them with: node --experimental-strip-types scripts/parser-samples.mts"
          />
          <ul className="mt-6 space-y-2 text-sm text-slate-600">
            {parserSamples.map((s) => (
              <li key={s.name} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                <span className="font-mono text-xs text-slate-500 sm:w-56">{s.name}</span>
                <span>{s.description}</span>
              </li>
            ))}
          </ul>
          {/* TODO(launch-blocker): synthetic samples are not a substitute for
              validating the parser against real bank statements before launch. */}
        </div>
      </Section>
    </>
  );
}
