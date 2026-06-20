import Link from "next/link";

// Compact, repeatable trust line for placing inside other sections/pages.
// Default copy is intentionally careful ("designed to") because the deletion
// and logging pipeline is not finished yet.
// TODO(launch-blocker): the "designed so your statement is used only to create
// your spreadsheet file" claim depends on verified deletion and logging in the
// production parser pipeline. Verify before launch.
export function PrivacyMiniBlock({
  line = "StatementCSV is designed so your bank statement is used only to create your spreadsheet file. We do not keep your statement data.",
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
          No bank login. No ads. No stored statement data.
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
