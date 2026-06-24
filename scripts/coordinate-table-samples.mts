// Runner for the synthetic coordinate-aware table samples (no test framework).
//
//   node --experimental-strip-types scripts/coordinate-table-samples.mts
//
// It builds positioned PDF text items from each fixture, runs the full parser
// (coordinate candidates + text fallback) and asserts the coordinate-table
// candidate is chosen and reconciles. Prints SAFE aggregates only — no real
// statement data is involved and nothing is stored.

import { parseStatementText } from "../src/lib/parser.ts";
import { computeBalanceCheck } from "../src/lib/upload.ts";
import { groupVisualLines } from "../src/lib/coordinate-table.ts";
import { buildSampleItems, coordinateSamples } from "../src/lib/coordinate-table-samples.ts";

const approx = (a: number | null, b: number | null): boolean => {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) < 0.01;
};

let mismatches = 0;

for (const sample of coordinateSamples) {
  const items = buildSampleItems(sample);
  // The plain-text fallback sees exactly what the production extractor produces.
  const text = groupVisualLines(items)
    .map((l) => l.text)
    .join("\n");
  const parsed = parseStatementText(text, items);
  const e = sample.expect;
  const expectedSource = e.source ?? "coordinate-table";

  const mode = parsed.statementKind === "credit-card" ? "credit-card" : "bank-account";
  const check = computeBalanceCheck(parsed.openingBalance, parsed.closingBalance, parsed.rows, mode);
  const totalCredits = parsed.rows.reduce((a, r) => a + (r.credit ?? 0), 0);
  const totalDebits = parsed.rows.reduce((a, r) => a + (r.debit ?? 0), 0);
  const ps = parsed.parseStats;

  const descViolations = (e.noDescriptionIncludes ?? []).filter((sub) =>
    parsed.rows.some((r) => r.description.includes(sub)),
  );
  // Every expected category substring must be captured on some row's (internal)
  // category field — confirms a separate category column is preserved, not dropped.
  const categoryMisses = (e.categoryIncludes ?? []).filter(
    (sub) => !parsed.rows.some((r) => (r.category ?? "").includes(sub)),
  );

  const checks: [string, boolean][] = [
    ["source", ps?.chosenCandidateSource === expectedSource],
    ["statementKind", parsed.statementKind === e.statementKind],
    ["rows", parsed.rows.length === e.rows],
    ["opening", approx(parsed.openingBalance, e.opening)],
    ["closing", approx(parsed.closingBalance, e.closing)],
    ["totalCredits", approx(totalCredits, e.totalCredits)],
    ["totalDebits", approx(totalDebits, e.totalDebits)],
    ["balancePasses", check.passed === e.balancePasses],
    // Column order is only meaningful when a coordinate candidate was chosen.
    ["columnOrder", expectedSource !== "coordinate-table" || ps?.coordColumnOrder === e.columnOrder],
    ["noSummaryInDesc", descViolations.length === 0],
    ["categoryCaptured", categoryMisses.length === 0],
    ["stitched", e.stitched === undefined || ps?.coordStitched === e.stitched],
    [
      "regionsStitched",
      e.regionsStitched === undefined || ps?.coordRegionsStitched === e.regionsStitched,
    ],
  ];

  const failed = checks.filter(([, ok]) => !ok).map(([n]) => n);
  const ok = failed.length === 0;
  if (!ok) mismatches += 1;

  console.log(`${ok ? "ok  " : "MISS"}  ${sample.name}`);
  console.log(
    `      source=${ps?.chosenCandidateSource} kind=${parsed.statementKind} cols=${ps?.coordColumnOrder} rows=${parsed.rows.length} cr=${totalCredits.toFixed(2)} dr=${totalDebits.toFixed(2)} open=${parsed.openingBalance} close=${parsed.closingBalance} balanced=${check.passed}`,
  );
  if (!ok) console.log(`      FAILED: ${failed.join(", ")}`);
  if (sample.expect.note) console.log(`      note: ${sample.expect.note}`);
}

console.log(
  mismatches === 0
    ? `\nAll ${coordinateSamples.length} coordinate-table samples met expectations.`
    : `\n${mismatches} coordinate-table sample(s) did not meet expectations.`,
);
process.exit(mismatches === 0 ? 0 : 1);
