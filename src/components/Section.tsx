import { ReactNode } from "react";
import { Container } from "@/components/Container";

export function Section({
  children,
  className = "",
  muted = false,
  id,
}: {
  children: ReactNode;
  className?: string;
  muted?: boolean;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={`py-12 sm:py-16 ${muted ? "bg-section" : "bg-transparent"} ${className}`}
    >
      <Container>{children}</Container>
    </section>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  centered = true,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  /**
   * Centered is the default so every section aligns to one shared centered
   * container logic. Pass `centered={false}` only for intentionally left-aligned
   * editorial layouts (e.g. a two-column "text + example" section).
   */
  centered?: boolean;
}) {
  return (
    <div className={`max-w-2xl ${centered ? "mx-auto text-center" : ""}`}>
      {eyebrow ? (
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-brand-600">
          {eyebrow}
        </p>
      ) : null}
      <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
        {title}
      </h2>
      {description ? (
        <p className="mt-3 text-base leading-relaxed text-slate-600 sm:text-lg">{description}</p>
      ) : null}
    </div>
  );
}
