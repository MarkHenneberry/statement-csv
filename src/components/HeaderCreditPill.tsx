import Link from "next/link";

// Shape returned by GET /api/preview-status (safe metadata only). Mirrored here so
// the header can render a compact indicator without any client-side billing logic.
export type PreviewStatus = {
  mode: "paid" | "preview";
  signedIn: boolean;
  previewPageLimit?: number;
  previewWindowHours?: number;
  previewPagesRemaining?: number;
  paidPagesRemaining?: number;
  monthlyPageAllowance?: number;
};

/** Resolve the pill label + tone from server status, or null when it shouldn't show. */
function resolvePill(
  status: PreviewStatus | null,
): { label: string; exhausted: boolean; href: string } | null {
  if (!status) return null;
  if (status.mode === "paid") {
    const n = status.paidPagesRemaining;
    if (typeof n !== "number") return null;
    return { label: `${n} ${n === 1 ? "page" : "pages"} left`, exhausted: false, href: "/account" };
  }
  const n = status.previewPagesRemaining;
  if (typeof n !== "number") return null;
  if (n <= 0) return { label: "Preview used", exhausted: true, href: "/pricing" };
  return { label: `${n} free ${n === 1 ? "page" : "pages"}`, exhausted: false, href: "/pricing" };
}

/**
 * Compact, subtle page-credit / free-preview indicator for the header. Renders
 * nothing when status is unavailable (so we never show wrong data) and exposes only
 * the remaining count — no plan name, account id, or other billing internals.
 */
export function HeaderCreditPill({
  status,
  className = "",
}: {
  status: PreviewStatus | null;
  className?: string;
}) {
  const pill = resolvePill(status);
  if (!pill) return null;
  const tone = pill.exhausted
    ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
    : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100";
  return (
    <Link
      href={pill.href}
      title={pill.exhausted ? "Free preview used — view plans" : "Pages remaining"}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium tabular-nums transition ${tone} ${className}`}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${pill.exhausted ? "bg-amber-500" : "bg-emerald-500"}`}
      />
      {pill.label}
    </Link>
  );
}
