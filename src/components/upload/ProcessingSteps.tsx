import { PROCESSING_STEPS } from "@/lib/upload";

function Spinner() {
  return (
    <svg className="h-5 w-5 animate-spin text-brand-600" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4Z" />
    </svg>
  );
}

function Check() {
  return (
    <svg className="h-5 w-5 text-emerald-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.5 7.6a1 1 0 0 1-1.43.005l-3.5-3.55a1 1 0 1 1 1.424-1.404l2.786 2.826 6.79-6.885a1 1 0 0 1 1.414-.006Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function ProcessingSteps({
  activeStep,
  fileName,
}: {
  /** Index of the currently-running step. Steps below it are complete. */
  activeStep: number;
  fileName?: string;
}) {
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
      <h2 className="text-center text-lg font-semibold text-slate-900">
        Converting your statement
      </h2>
      {fileName ? (
        <p className="mt-1 truncate text-center text-sm text-slate-500">{fileName}</p>
      ) : null}

      <ol className="mt-8 space-y-4">
        {PROCESSING_STEPS.map((step, index) => {
          const done = index < activeStep;
          const active = index === activeStep;
          return (
            <li key={step} className="flex items-center gap-3">
              <span className="flex h-6 w-6 flex-none items-center justify-center">
                {done ? <Check /> : active ? <Spinner /> : (
                  <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
                )}
              </span>
              <span
                className={`text-sm ${
                  done
                    ? "text-slate-500"
                    : active
                      ? "font-medium text-slate-900"
                      : "text-slate-400"
                }`}
              >
                {step}
              </span>
            </li>
          );
        })}
      </ol>

      <p className="mt-8 text-center text-xs text-slate-400">
        Balance checks help catch missing or misread transactions before export.
      </p>
    </div>
  );
}
