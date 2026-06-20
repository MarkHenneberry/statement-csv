export type Step = {
  title: string;
  body: string;
};

const defaultSteps: Step[] = [
  {
    title: "Upload your PDF statement",
    body: "Choose the PDF you downloaded from your bank. No account or bank login needed.",
  },
  {
    title: "Review the transactions",
    body: "We extract the dates, descriptions, and amounts so you can check them before downloading.",
  },
  {
    title: "Download your CSV",
    body: "Get a clean, spreadsheet-ready CSV for Excel, Google Sheets, or your bookkeeping tool.",
  },
];

export function HowItWorks({ steps = defaultSteps }: { steps?: Step[] }) {
  return (
    <ol className="grid gap-6 md:grid-cols-3">
      {steps.map((step, index) => (
        <li
          key={step.title}
          className="relative rounded-2xl border border-slate-200 bg-white p-6"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-base font-bold text-brand-700">
            {index + 1}
          </span>
          <h3 className="mt-4 text-lg font-semibold text-slate-900">{step.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{step.body}</p>
        </li>
      ))}
    </ol>
  );
}
