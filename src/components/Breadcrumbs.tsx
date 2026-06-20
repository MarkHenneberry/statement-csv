import Link from "next/link";

export function Breadcrumbs({
  crumbs,
}: {
  crumbs: { name: string; path: string }[];
}) {
  return (
    <nav aria-label="Breadcrumb" className="mb-6">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-slate-500">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <li key={crumb.path} className="flex items-center gap-1">
              {isLast ? (
                <span className="font-medium text-slate-700" aria-current="page">
                  {crumb.name}
                </span>
              ) : (
                <Link href={crumb.path} className="transition hover:text-slate-700">
                  {crumb.name}
                </Link>
              )}
              {!isLast ? <span className="text-slate-300">/</span> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
