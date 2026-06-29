import { ReactNode } from "react";
import { Container } from "@/components/Container";
import { ButtonLink } from "@/components/Button";

export function Hero({
  title,
  children,
  primaryCta = { label: "Convert a Statement", href: "/upload" },
  secondaryCta,
}: {
  title: string;
  children: ReactNode;
  primaryCta?: { label: string; href: string };
  secondaryCta?: { label: string; href: string };
}) {
  return (
    <section className="relative overflow-hidden border-b border-slate-200 bg-transparent">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 bg-gradient-to-b from-brand-50 to-transparent"
      />
      <Container className="py-12 sm:py-20">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="mx-auto max-w-2xl text-balance text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            {title}
          </h1>
          <div className="mx-auto mt-5 max-w-2xl space-y-4 text-base leading-relaxed text-slate-600 sm:text-lg">
            {children}
          </div>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <ButtonLink href={primaryCta.href}>{primaryCta.label}</ButtonLink>
            {secondaryCta ? (
              <ButtonLink href={secondaryCta.href} variant="secondary">
                {secondaryCta.label}
              </ButtonLink>
            ) : null}
          </div>
          {/* TODO(launch-blocker): "Balance checks before export" depends on the
              validation pipeline, which is not fully verified yet. Verify before
              launch. */}
          <p className="mt-6 text-sm text-slate-500">
            No bank login &middot; Balance checks before export
          </p>
        </div>
      </Container>
    </section>
  );
}
