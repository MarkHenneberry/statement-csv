import Link from "next/link";
import { Container } from "@/components/Container";
import { BrandMark } from "@/components/BrandMark";
import { footerNav, siteConfig } from "@/lib/site";

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-slate-200 bg-section">
      <Container className="py-10">
        {/* One unified, centered footer: brand → link groups → copyright, in a
            single vertical flow (no separate stacked "bar" beneath the grid). */}
        <div className="flex flex-col items-center text-center">
          <BrandMark imgClassName="h-9 w-auto" textClassName="text-base" />
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-slate-600">
            {siteConfig.tagline} No bank login.
          </p>
        </div>

        <nav
          aria-label="Footer"
          className="mx-auto mt-8 grid max-w-3xl grid-cols-2 gap-x-6 gap-y-8 text-center sm:grid-cols-4"
        >
          {footerNav.map((group) => (
            <div key={group.title}>
              <h3 className="text-sm font-semibold text-slate-900">{group.title}</h3>
              <ul className="mt-3 space-y-2.5">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-slate-600 transition hover:text-slate-900"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <p className="mx-auto mt-8 max-w-2xl border-t border-slate-200 pt-6 text-center text-xs leading-relaxed text-slate-500">
          &copy; {year} {siteConfig.name}. StatementCSV is an independent tool and is not
          affiliated with or endorsed by any bank.
        </p>
      </Container>
    </footer>
  );
}
