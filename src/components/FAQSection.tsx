import type { FaqItem } from "@/lib/faq";

export function FAQSection({ items }: { items: FaqItem[] }) {
  return (
    <dl className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-surface shadow-card">
      {items.map((item) => (
        <details key={item.question} className="group p-5">
          <summary className="flex cursor-pointer items-center justify-between gap-4 text-left text-base font-semibold text-slate-900 [&::-webkit-details-marker]:hidden">
            <dt>{item.question}</dt>
            <svg
              className="h-5 w-5 flex-none text-slate-400 transition group-open:rotate-180"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
                clipRule="evenodd"
              />
            </svg>
          </summary>
          <dd className="mt-3 text-sm leading-relaxed text-slate-600">
            {item.answer}
          </dd>
        </details>
      ))}
    </dl>
  );
}
