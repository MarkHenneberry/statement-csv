import Link from "next/link";

// Compact, repeatable trust line for placing inside other sections/pages.
// Default copy is intentionally careful: it claims only what the implementation
// supports (no bank login, not used for marketing) and avoids any
// retention/deletion guarantee.
// TODO(launch-blocker): any retention/deletion wording added here depends on
// verified deletion and logging in the production parser pipeline. Verify
// before launch.
export function PrivacyMiniBlock({
  line = "StatementCSV processes your statement to create your spreadsheet file, and your statement data is not sold or used for marketing or ads.",
  showLink = true,
  className = "",
}: {
  line?: string;
  showLink?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 ${className}`}
    >
      <p>
        <span className="font-semibold text-slate-900">
          No bank login. Not used for marketing.
        </span>{" "}
        {line}{" "}
        {showLink ? (
          <Link href="/security" className="font-medium text-brand-700 hover:underline">
            Read about security
          </Link>
        ) : null}
      </p>
    </div>
  );
}
