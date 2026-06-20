import Link from "next/link";
import { pricingPlans } from "@/lib/pricing";

function CheckIcon() {
  return (
    <svg
      className="mt-0.5 h-5 w-5 flex-none text-brand-600"
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
  );
}

export function PricingCards() {
  return (
    <div className="grid gap-6 lg:grid-cols-4">
      {pricingPlans.map((plan) => (
        <div
          key={plan.name}
          className={`flex flex-col rounded-2xl border bg-white p-6 shadow-sm ${
            plan.highlighted
              ? "border-brand-600 ring-1 ring-brand-600"
              : "border-slate-200"
          }`}
        >
          {plan.highlighted ? (
            <span className="mb-3 inline-flex w-fit rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
              Most popular
            </span>
          ) : null}
          <h3 className="text-lg font-semibold text-slate-900">{plan.name}</h3>
          <p className="mt-2 flex items-baseline gap-1">
            <span className="text-3xl font-bold tracking-tight text-slate-900">
              {plan.price}
            </span>
            {plan.priceSuffix ? (
              <span className="text-sm font-medium text-slate-500">
                {plan.priceSuffix}
              </span>
            ) : null}
          </p>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            {plan.description}
          </p>
          <ul className="mt-6 flex-1 space-y-3">
            {plan.features.map((feature) => (
              <li key={feature} className="flex gap-2 text-sm text-slate-700">
                <CheckIcon />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
          <Link
            href={plan.cta.href}
            className={`mt-8 inline-flex w-full items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold transition ${
              plan.highlighted
                ? "bg-brand-600 text-white hover:bg-brand-700"
                : "bg-slate-900 text-white hover:bg-slate-800"
            }`}
          >
            {plan.cta.label}
          </Link>
        </div>
      ))}
    </div>
  );
}
