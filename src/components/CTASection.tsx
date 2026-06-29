import { Container } from "@/components/Container";
import { ButtonLink } from "@/components/Button";

export function CTASection({
  title = "Ready to convert your statement?",
  description = "Upload a PDF, review the extracted transactions, and download a clean CSV.",
  primaryCta = { label: "Convert a Statement", href: "/upload" },
  secondaryCta = { label: "See Pricing", href: "/pricing" },
}: {
  title?: string;
  description?: string;
  primaryCta?: { label: string; href: string };
  secondaryCta?: { label: string; href: string };
}) {
  return (
    <section className="bg-brand-600">
      <Container className="py-12 sm:py-16">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            {title}
          </h2>
          <p className="mt-3 text-base leading-relaxed text-brand-50 sm:text-lg">{description}</p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <ButtonLink href={primaryCta.href} variant="secondary">
              {primaryCta.label}
            </ButtonLink>
            <ButtonLink
              href={secondaryCta.href}
              className="bg-transparent text-white ring-1 ring-inset ring-white/50 hover:bg-white/10"
            >
              {secondaryCta.label}
            </ButtonLink>
          </div>
        </div>
      </Container>
    </section>
  );
}
