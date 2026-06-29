"use client";

import { useState } from "react";
import Link from "next/link";
import { siteConfig } from "@/lib/site";

/**
 * Shared brand lockup (logo mark + wordmark) used by the header and footer so the
 * visual identity is identical in both. Falls back to an "SC" lettermark only if
 * the logo image fails to load. Size is controlled by the caller.
 */
export function BrandMark({
  imgClassName = "h-10 w-auto",
  textClassName = "text-lg",
  className = "",
}: {
  imgClassName?: string;
  textClassName?: string;
  className?: string;
}) {
  const [logoOk, setLogoOk] = useState(true);
  return (
    <Link
      href="/"
      aria-label={siteConfig.name}
      className={`inline-flex items-center gap-2 ${className}`}
    >
      {logoOk ? (
        // eslint-disable-next-line @next/next/no-img-element -- small static logo; onError fallback needs a plain img
        <img
          src="/images/statementcsv-logo.png"
          alt=""
          className={imgClassName}
          onError={() => setLogoOk(false)}
        />
      ) : (
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-brand-600 text-sm font-bold text-white">
          SC
        </span>
      )}
      <span className={`font-semibold tracking-tight text-slate-900 ${textClassName}`}>
        {siteConfig.name}
      </span>
    </Link>
  );
}
