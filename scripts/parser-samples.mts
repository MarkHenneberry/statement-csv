// Lightweight, dependency-free runner for the synthetic parser samples.
//
// Usage (no test framework required):
//   node --experimental-strip-types scripts/parser-samples.mts
//
// It prints SAFE diagnostics (counts/statuses) for each synthetic, FAKE sample.
// It does not read any real statement and stores nothing.

import { parseStatementText } from "../src/lib/parser.ts";
import { computeBalanceCheck } from "../src/lib/upload.ts";
import { parserSamples } from "../src/lib/parser-samples.ts";

let mismatches = 0;

for (const sample of parserSamples) {
  const parsed = parseStatementText(sample.text);
  const e = sample.expect;

  const rows = parsed.rows.length;
  const opening = parsed.openingBalance !== null;
  const closing = parsed.closingBalance !== null;
  const creditRows = parsed.rows.filter((r) => r.credit !== null).length;
  const debitRows = parsed.rows.filter((r) => r.debit !== null).length;
  const allBalancesNull = parsed.rows.every((r) => r.balance === null);

  const mode = parsed.statementKind === "credit-card" ? "credit-card" : "bank-account";
  const check = computeBalanceCheck(
    parsed.openingBalance,
    parsed.closingBalance,
    parsed.rows,
    mode,
  );

  const checks: [string, boolean][] = [
    ["minRows", rows >= e.minRows],
    ["maxRows", e.maxRows === undefined || rows <= e.maxRows],
    ["kind", e.kind === undefined || parsed.statementKind === e.kind],
    ["opening", e.opening === undefined || e.opening === opening],
    ["closing", e.closing === undefined || e.closing === closing],
    ["creditRows", e.creditRows === undefined || creditRows >= e.creditRows],
    ["debitRows", e.debitRows === undefined || debitRows >= e.debitRows],
    ["noCredit", e.noCredit === undefined || creditRows === 0],
    ["noDebit", e.noDebit === undefined || debitRows === 0],
    ["balancePasses", e.balancePasses === undefined || check.passed === e.balancePasses],
    ["balanceNull", e.balanceNull === undefined || allBalancesNull === e.balanceNull],
  ];

  const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
  const ok = failed.length === 0;
  if (!ok) mismatches += 1;

  console.log(`${ok ? "ok  " : "MISS"}  ${sample.name}`);
  console.log(
    `      kind=${parsed.statementKind} rows=${rows} debit=${debitRows} credit=${creditRows} opening=${opening} closing=${closing} balancePassed=${check.passed} warnings=${parsed.warnings.length}`,
  );
  if (!ok) console.log(`      FAILED: ${failed.join(", ")}`);
  if (sample.expect.note) console.log(`      note: ${sample.expect.note}`);
}

console.log(
  mismatches === 0
    ? `\nAll ${parserSamples.length} synthetic samples met expectations.`
    : `\n${mismatches} sample(s) did not meet expectations.`,
);
process.exit(mismatches === 0 ? 0 : 1);
