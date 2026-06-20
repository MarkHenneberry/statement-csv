import Link from "next/link";
import { ReactNode } from "react";

type Variant = "primary" | "secondary";

const styles: Record<Variant, string> = {
  primary:
    "bg-brand-600 text-white hover:bg-brand-700 focus-visible:outline-brand-600",
  secondary:
    "bg-white text-slate-900 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 focus-visible:outline-slate-400",
};

export function ButtonLink({
  href,
  children,
  variant = "primary",
  className = "",
}: {
  href: string;
  children: ReactNode;
  variant?: Variant;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center rounded-lg px-5 py-3 text-base font-semibold shadow-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${styles[variant]} ${className}`}
    >
      {children}
    </Link>
  );
}
