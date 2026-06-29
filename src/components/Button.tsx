import Link from "next/link";
import { ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "destructive";

// One button system, shared by links and (future) <button>s. Consistent height,
// padding, radius, weight, hover + focus states, and ~44px mobile tap target.
const styles: Record<Variant, string> = {
  primary: "bg-brand-600 text-white shadow-sm hover:bg-brand-700",
  secondary:
    "bg-white text-slate-900 ring-1 ring-inset ring-slate-300 hover:bg-slate-50",
  ghost: "bg-transparent text-brand-700 hover:bg-brand-50",
  destructive: "bg-red-600 text-white shadow-sm hover:bg-red-700",
};

export const BUTTON_BASE =
  "inline-flex min-h-[2.75rem] items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 sm:px-5 sm:text-base";

export function buttonClasses(variant: Variant = "primary", className = ""): string {
  return `${BUTTON_BASE} ${styles[variant]} ${className}`;
}

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
    <Link href={href} className={buttonClasses(variant, className)}>
      {children}
    </Link>
  );
}
