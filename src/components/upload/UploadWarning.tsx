import { ReactNode } from "react";

type Variant = "error" | "warning" | "info" | "success";

const styles: Record<Variant, { box: string; icon: string; title: string }> = {
  error: {
    box: "border-red-200 bg-red-50",
    icon: "text-red-500",
    title: "text-red-800",
  },
  warning: {
    box: "border-amber-200 bg-amber-50",
    icon: "text-amber-500",
    title: "text-amber-800",
  },
  info: {
    box: "border-brand-200 bg-brand-50",
    icon: "text-brand-600",
    title: "text-brand-800",
  },
  success: {
    box: "border-emerald-200 bg-emerald-50",
    icon: "text-emerald-600",
    title: "text-emerald-800",
  },
};

function Icon({ variant, className }: { variant: Variant; className?: string }) {
  if (variant === "success") {
    return (
      <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path
          fillRule="evenodd"
          d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.5 7.6a1 1 0 0 1-1.43.005l-3.5-3.55a1 1 0 1 1 1.424-1.404l2.786 2.826 6.79-6.885a1 1 0 0 1 1.414-.006Z"
          clipRule="evenodd"
        />
      </svg>
    );
  }
  if (variant === "info") {
    return (
      <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-11.25a.75.75 0 0 0-1.5 0v.5a.75.75 0 0 0 1.5 0v-.5ZM10 9a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 9Z"
          clipRule="evenodd"
        />
      </svg>
    );
  }
  // error + warning share a triangle.
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 6a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 6Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function UploadWarning({
  variant = "warning",
  title,
  children,
  className = "",
  dense = false,
}: {
  variant?: Variant;
  title: string;
  children?: ReactNode;
  className?: string;
  /** Compact spacing/typography for the dense review flow. */
  dense?: boolean;
}) {
  const s = styles[variant];
  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      className={`flex border ${
        dense ? "gap-2 rounded-lg p-3" : "gap-3 rounded-xl p-4"
      } ${s.box} ${className}`}
    >
      <Icon
        variant={variant}
        className={`mt-0.5 flex-none ${dense ? "h-4 w-4" : "h-5 w-5"} ${s.icon}`}
      />
      <div className={dense ? "text-xs" : "text-sm"}>
        <p className={`font-semibold ${s.title}`}>{title}</p>
        {children ? <div className="mt-1 text-slate-600">{children}</div> : null}
      </div>
    </div>
  );
}
