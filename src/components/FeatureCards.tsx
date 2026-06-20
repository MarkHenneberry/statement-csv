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
    <div className={`grid gap-6 ${colClass}`}>
      {items.map((item) => (
        <div
          key={item.title}
          className="rounded-2xl border border-slate-200 bg-white p-6 transition hover:border-slate-300 hover:shadow-sm"
        >
          {item.icon ? (
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
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
