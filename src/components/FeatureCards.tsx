import { ReactNode } from "react";

export type FeatureCard = {
  title: string;
  body: string;
  icon?: ReactNode;
};

export function FeatureCards({
  items,
  columns = 3,
}: {
  items: FeatureCard[];
  columns?: 2 | 3 | 4;
}) {
  const colClass = {
    2: "sm:grid-cols-2",
    3: "sm:grid-cols-2 lg:grid-cols-3",
    4: "sm:grid-cols-2 lg:grid-cols-4",
  }[columns];

  return (
    <div className={`grid gap-5 ${colClass}`}>
      {items.map((item) => (
        <div
          key={item.title}
          className="rounded-xl border border-slate-200 bg-surface p-5 shadow-card transition hover:border-brand-300 hover:shadow-card-hover"
        >
          {item.icon ? (
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
              {item.icon}
            </div>
          ) : null}
          <h3 className="text-base font-semibold text-slate-900">{item.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.body}</p>
        </div>
      ))}
    </div>
  );
}
