import { Section, SectionHeading } from "@/components/Section";
import { FeatureCards, type FeatureCard } from "@/components/FeatureCards";

const defaultAudiences: FeatureCard[] = [
  {
    title: "Bookkeepers & accountants",
    body: "Turn client statements into clean rows for reconciliation and bookkeeping cleanup instead of typing them in by hand.",
  },
  {
    title: "Small business owners",
    body: "Pull a month or a year of transactions into a spreadsheet for accounting, expenses, and tax preparation.",
  },
  {
    title: "Anyone budgeting",
    body: "Get your spending into Excel or Google Sheets so you can sort, filter, and categorize it your way.",
  },
];

export function WhoUsesThisTool({
  muted = false,
  heading = "Who uses StatementCSV",
  description = "It is built for anyone who needs statement data in a spreadsheet rather than a PDF.",
  audiences = defaultAudiences,
}: {
  muted?: boolean;
  heading?: string;
  description?: string;
  audiences?: FeatureCard[];
}) {
  return (
    <Section muted={muted}>
      <SectionHeading eyebrow="Who it is for" title={heading} description={description} />
      <div className="mt-12">
        <FeatureCards items={audiences} columns={3} />
      </div>
    </Section>
  );
}
