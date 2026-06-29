"use client";

import { useState } from "react";
import Link from "next/link";
import { Container } from "@/components/Container";
import { ButtonLink } from "@/components/Button";
import { BrandMark } from "@/components/BrandMark";
import { primaryNav } from "@/lib/site";

export function Header() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <Container>
        <div className="flex h-16 items-center justify-between">
          <BrandMark imgClassName="h-10 w-auto" textClassName="text-lg" />

          <nav className="hidden items-center gap-8 md:flex" aria-label="Primary">
            {primaryNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm font-medium text-slate-600 transition hover:text-slate-900"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="hidden md:block">
            <ButtonLink href="/upload">Convert a Statement</ButtonLink>
          </div>

          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md p-2 text-slate-700 md:hidden"
            aria-label="Toggle menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
              {open ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
              )}
            </svg>
          </button>
        </div>
      </Container>

      {open ? (
        <div className="border-t border-slate-200 md:hidden">
          <Container className="py-4">
            <nav className="flex flex-col gap-3" aria-label="Mobile">
              {primaryNav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-md px-2 py-2 text-base font-medium text-slate-700 hover:bg-slate-50"
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </Link>
              ))}
              <ButtonLink href="/upload" className="mt-2 w-full">
                Convert a Statement
              </ButtonLink>
            </nav>
          </Container>
        </div>
      ) : null}
    </header>
  );
}
