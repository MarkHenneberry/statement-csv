import { Section, SectionHeading } from "@/components/Section";

// Explains, in plain English, what the converter actually does to a statement.
// Default points describe the real extraction behavior; pages may override.
const defaultPoints: string[] = [
  "Identifies transaction lines and separates them from headers and totals.",
  "Separates the description from the money values on each line.",
  "Keeps debits and credits in their own fields.",
  "Calculates the amount from the debit or credit so the two never disagree.",
  "Includes the running balance where the statement provides one.",
  "Flags rows that may need review with row warnings and balance checks.",
];

export function BankStatementTechnicalExplainer({
  muted = false,
  eyebrow = "How the extraction works",
  heading = "From PDF statement to structured transaction data",
  intro = "StatementCSV reads the statement as transaction data, not as a generic document. It turns each transaction line into a structured row you can review before export.",
  points = defaultPoints,
}: {
  muted?: boolean;
  eyebrow?: string;
  heading?: string;
  intro?: string;
  points?: string[];
}) {
  return (
    <Section muted={muted}>
      <div className="mx-auto max-w-3xl">
        <SectionHeading eyebrow={eyebrow} title={heading} description={intro} />
        <ul className="mt-8 space-y-3">
          {points.map((point) => (
            <li key={point} className="flex gap-3 text-base text-slate-700">
              <svg
                className="mt-1 h-5 w-5 flex-none text-brand-600"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.5 7.6a1 1 0 0 1-1.43.005l-3.5-3.55a1 1 0 1 1 1.424-1.404l2.786 2.826 6.79-6.885a1 1 0 0 1 1.414-.006Z"
                  clipRule="evenodd"
                />
              </svg>
              <span>{point}</span>
            </li>
          ))}
        </ul>
        {/* TODO(launch-blocker): the extraction behavior described here is an MVP
            parser prototype and has not been tested against a representative set
            of real bank statements. Verify parser accuracy before launch. */}
      </div>
    </Section>
  );
}
