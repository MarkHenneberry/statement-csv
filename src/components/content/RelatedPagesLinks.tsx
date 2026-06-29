import Link from "next/link";
import { Section, SectionHeading } from "@/components/Section";

export type RelatedLink = {
  label: string;
  href: string;
  description?: string;
};

export function RelatedPagesLinks({
  muted = false,
  heading = "Related pages",
  description,
  links,
}: {
  muted?: boolean;
  heading?: string;
  description?: string;
  links: RelatedLink[];
}) {
  return (
    <Section muted={muted}>
      <SectionHeading title={heading} description={description} />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="group rounded-xl border border-slate-200 bg-surface p-5 shadow-card transition hover:border-brand-300 hover:shadow-card-hover"
          >
            <span className="flex items-center justify-between gap-2 text-base font-semibold text-slate-900">
              {link.label}
              <span className="text-brand-600 transition group-hover:translate-x-0.5">
                &rarr;
              </span>
            </span>
            {link.description ? (
              <span className="mt-1 block text-sm text-slate-600">{link.description}</span>
            ) : null}
          </Link>
        ))}
      </div>
    </Section>
  );
}
