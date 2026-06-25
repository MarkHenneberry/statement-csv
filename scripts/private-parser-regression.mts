// Local private parser regression runner.
//
// Lets you test your OWN real PDF bank statements without committing them.
// Reads ./private-test-manifest.json (gitignored). If it is absent, this script
// is a no-op so it is safe to run in any environment.
//
// Usage:
//   node --experimental-strip-types scripts/private-parser-regression.mts
//
// PRIVACY: this prints ONLY aggregate pass/fail metrics and the expected-vs-
// actual aggregate numbers you put in the manifest. It never prints raw
// extracted text, descriptions, names, addresses, account numbers, or rows.

import { readFileSync, existsSync } from "node:fs";
import { extractPdfText } from "../src/lib/pdf-extract-core.ts";
import { parseStatement } from "../src/lib/statement-pipeline.ts";
import { computeBalanceCheck } from "../src/lib/upload.ts";

type ManifestEntry = {
  path: string;
  expectedStatementKind?: string;
  expectedLayoutFamily?: string;
  expectedRowCount?: number;
  expectedOpeningBalance?: number;
  expectedClosingBalance?: number;
  expectedTotalCredits?: number;
  expectedTotalDebits?: number;
  expectedBalanceStatus?: "passed" | "needs-review" | "limited";
};

const MANIFEST = "private-test-manifest.json";

function round2(n: number | null): number | null {
  return n === null ? null : Math.round(n * 100) / 100;
}

function approx(a: number | null, b: number | undefined): boolean {
  if (b === undefined) return true;
  if (a === null) return false;
  return Math.abs(a - b) < 0.01;
}

if (!existsSync(MANIFEST)) {
  console.log(`No ${MANIFEST} found — skipping private regression (this is fine).`);
  process.exit(0);
}

const raw = readFileSync(MANIFEST, "utf8").trim();
if (raw === "") {
  console.log(`${MANIFEST} is empty — skipping private regression (this is fine).`);
  process.exit(0);
}

let manifest: { statements: ManifestEntry[] };
try {
  manifest = JSON.parse(raw) as { statements: ManifestEntry[] };
} catch {
  console.log(`${MANIFEST} is not valid JSON — fix it or empty it to skip. Aborting.`);
  process.exit(1);
}

let failures = 0;

for (const entry of manifest.statements ?? []) {
  const label = entry.path.split(/[\\/]/).pop() ?? entry.path;
  try {
    const bytes = new Uint8Array(readFileSync(entry.path));
    const extracted = await extractPdfText(bytes);
    // Run the FULL pipeline (text/coordinate parse → model build → validation) so
    // the model-level cleanup (e.g. metadata/category separation) is reflected,
    // exactly as the app produces the displayed/exported rows.
    const { statement, result } = parseStatement({
      text: extracted.pages.join("\n"),
      items: extracted.items,
    });
    const parsed = {
      statementKind: statement.statementKind,
      layoutFamily: result.layoutFamily,
      rows: statement.transactions.map((t) => ({
        description: t.description,
        debit: t.debit ?? null,
        credit: t.credit ?? null,
      })),
      openingBalance: statement.openingBalance ?? null,
      closingBalance: statement.closingBalance ?? null,
    };

    const mode = parsed.statementKind === "credit-card" ? "credit-card" : "bank-account";
    const check = computeBalanceCheck(
      parsed.openingBalance,
      parsed.closingBalance,
      parsed.rows,
      mode,
    );
    const status = !check.available ? "limited" : check.passed ? "passed" : "needs-review";

    // Content-safe metadata-leak check: a credit-card description that ENDS with a
    // known ambiguous spend-category label (after real merchant text) means a
    // statement-provided category leaked into Description. Counts only — no text.
    const TRAILING_CATEGORY_LEAK_RE =
      /\b(restaurants|transportation|transport|groceries|merchandise|healthcare)\s*$/i;
    const categoryLeaks =
      parsed.statementKind === "credit-card"
        ? parsed.rows.filter(
            (r) =>
              TRAILING_CATEGORY_LEAK_RE.test(r.description) &&
              r.description.trim().split(/\s+/).length >= 2,
          ).length
        : 0;

    const actual = {
      statementKind: parsed.statementKind,
      layoutFamily: parsed.layoutFamily,
      rowCount: parsed.rows.length,
      openingBalance: round2(parsed.openingBalance),
      closingBalance: round2(parsed.closingBalance),
      totalCredits: round2(check.totalCredits),
      totalDebits: round2(check.totalDebits),
      balanceStatus: status,
    };

    const mismatches: string[] = [];
    if (entry.expectedStatementKind && actual.statementKind !== entry.expectedStatementKind)
      mismatches.push(`kind ${actual.statementKind}≠${entry.expectedStatementKind}`);
    if (entry.expectedLayoutFamily && actual.layoutFamily !== entry.expectedLayoutFamily)
      mismatches.push(`family ${actual.layoutFamily}≠${entry.expectedLayoutFamily}`);
    if (entry.expectedRowCount !== undefined && actual.rowCount !== entry.expectedRowCount)
      mismatches.push(`rows ${actual.rowCount}≠${entry.expectedRowCount}`);
    if (!approx(actual.openingBalance, entry.expectedOpeningBalance))
      mismatches.push(`opening ${actual.openingBalance}≠${entry.expectedOpeningBalance}`);
    if (!approx(actual.closingBalance, entry.expectedClosingBalance))
      mismatches.push(`closing ${actual.closingBalance}≠${entry.expectedClosingBalance}`);
    if (!approx(actual.totalCredits, entry.expectedTotalCredits))
      mismatches.push(`credits ${actual.totalCredits}≠${entry.expectedTotalCredits}`);
    if (!approx(actual.totalDebits, entry.expectedTotalDebits))
      mismatches.push(`debits ${actual.totalDebits}≠${entry.expectedTotalDebits}`);
    if (entry.expectedBalanceStatus && actual.balanceStatus !== entry.expectedBalanceStatus)
      mismatches.push(`status ${actual.balanceStatus}≠${entry.expectedBalanceStatus}`);
    if (categoryLeaks > 0) mismatches.push(`category-leaks ${categoryLeaks}`);

    if (mismatches.length === 0) {
      const ps = result.parseStats;
      const diag = ps
        ? ` [inherited=${ps.rowsDateInherited} stillMissing=${ps.rowsStillMissingDate} eTransfer=${ps.eTransferDescriptionsNormalized} refRemoved=${ps.rawReferenceFragmentsRemoved} catLeaks=${categoryLeaks}]`
        : "";
      console.log(`PASS  ${label}${diag}`);
    } else {
      failures += 1;
      console.log(`FAIL  ${label}: ${mismatches.join(", ")}`);
    }
  } catch (err) {
    // A missing file is environmental (partial corpus), not a parser failure —
    // skip it so the harness stays runnable when only some statements are present.
    if (err && typeof err === "object" && (err as { code?: string }).code === "ENOENT") {
      console.log(`SKIP  ${label} (file not present)`);
      continue;
    }
    failures += 1;
    const message = err instanceof Error ? err.message : "unknown error";
    console.log(`ERROR ${label}: ${message}`);
  }
}

console.log(
  failures === 0
    ? `\nAll ${manifest.statements?.length ?? 0} private statement(s) met expectations.`
    : `\n${failures} private statement(s) did not meet expectations.`,
);
process.exit(failures === 0 ? 0 : 1);
