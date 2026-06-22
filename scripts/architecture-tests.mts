// Architecture invariant tests (no test framework).
//
//   node --experimental-strip-types scripts/architecture-tests.mts
//
// These assert ARCHITECTURE behavior — the PDF → ParsedStatement → validation →
// export model — rather than specific bank statements. They use synthetic, FAKE
// text/items only and store nothing.

import { parseStatementText } from "../src/lib/parser.ts";
import { parseStatement, PARSER_PIPELINE_STAGES } from "../src/lib/statement-pipeline.ts";
import {
  buildParsedStatement,
  parsedStatementToRows,
} from "../src/lib/statement-model.ts";
import { detectStatementProfile, STATEMENT_PROFILES } from "../src/lib/statement-profiles.ts";
import { rowsToCsv } from "../src/lib/upload.ts";
import { groupVisualLines, probeCoordinateHeaders } from "../src/lib/coordinate-table.ts";
import { buildItems, coordinateSamples } from "../src/lib/coordinate-table-samples.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`ok    ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const BANK_TEXT = [
  "Some Bank Chequing",
  "Statement period January 1 to January 31, 2026",
  "Details of your account activity",
  "Date Description Withdrawals Deposits Balance",
  "Opening Balance 2,000.00",
  "Jan 3 Payroll Deposit 1,500.00 3,500.00",
  "Jan 5 Hydro One 120.00 3,380.00",
  "Closing Balance 3,380.00",
  "Total deposits 1,500.00",
  "Total withdrawals 120.00",
].join("\n");

const SUMMARY_HEAVY_CC = [
  "RBC ROYAL BANK VISA",
  "STATEMENT FROM APR 24 TO MAY 25, 2026",
  "PAYMENT DUE DATE MAY 21, 2026",
  "MINIMUM PAYMENT $10.00",
  "Credit Limit $10,000.00",
  "Available Credit $9,500.00",
  "Previous Account Balance $500.00",
  "APR 25 APR 26 BOOK STORE TORONTO ON",
  "74000000000000000000010",
  "$120.00",
  "APR 29 APR 29 PAYMENT - THANK YOU / PAIEMENT - MERCI",
  "74000000000000000000011",
  "-$50.00",
  "New Balance $570.00",
  "TOTAL ACCOUNT BALANCE $570.00",
  "TIME TO PAY",
].join("\n");

// 1. The model carries a validation status + numeric confidence + issues array.
{
  const result = parseStatementText(BANK_TEXT);
  const statement = buildParsedStatement(result, { fileName: "x.pdf" });
  check(
    "validation present (status + confidence + issues)",
    ["passed", "needs-review", "limited"].includes(statement.validation.status) &&
      typeof statement.validation.confidence === "number" &&
      statement.validation.confidence >= 0 &&
      statement.validation.confidence <= 1 &&
      Array.isArray(statement.validation.issues),
    JSON.stringify(statement.validation),
  );
  check(
    "bank statement reconciles to passed with high confidence",
    statement.validation.status === "passed" && statement.validation.confidence >= 0.8,
    `status=${statement.validation.status} conf=${statement.validation.confidence}`,
  );
}

// 2. Transactions carry normalized amount + debit/credit + confidence + issues.
{
  const { statement } = parseStatement({ text: BANK_TEXT });
  const t = statement.transactions[0];
  const consistent = statement.transactions.every((tx) => {
    const hasDebit = tx.debit !== undefined;
    const hasCredit = tx.credit !== undefined;
    const amountOk =
      (hasDebit && tx.amount <= 0) || (hasCredit && tx.amount >= 0) || (!hasDebit && !hasCredit);
    return typeof tx.amount === "number" && typeof tx.confidence === "number" && Array.isArray(tx.issues) && amountOk;
  });
  check("transactions have normalized amount/debit/credit + confidence + issues", Boolean(t) && consistent);
}

// 3. Export uses ParsedStatement.transactions (model → rows), not raw text.
{
  const { statement, rows } = parseStatement({ text: BANK_TEXT });
  const fromModel = parsedStatementToRows(statement);
  const csv = rowsToCsv(rows);
  check("export rows are derived from model transactions", fromModel.length === statement.transactions.length && rows.length === statement.transactions.length);
  check(
    "CSV contains only normalized fields, never raw statement lines",
    csv.startsWith("Date,Description,Debit,Credit,Amount,Balance,Category") &&
      !csv.includes("Details of your account activity") &&
      !csv.includes("Opening Balance 2,000.00"),
  );
}

// 4. Summary rows validate totals but never become transactions.
{
  const { statement } = parseStatement({ text: SUMMARY_HEAVY_CC });
  const descs = statement.transactions.map((t) => t.description.toLowerCase());
  const leaked = descs.some(
    (d) => d.includes("credit limit") || d.includes("available credit") || d.includes("minimum payment"),
  );
  check("summary rows did not become transactions", !leaked && statement.transactions.length === 2);
  check(
    "summary totals captured for validation",
    statement.summaryTotals !== undefined || statement.validation.status !== "limited",
  );
}

// 5. rawText / internal raw lines never appear on the model or the export rows.
{
  const { statement, rows, result } = parseStatement({ text: BANK_TEXT });
  const serialized = JSON.stringify({ statement, rows });
  const hasRawTextField =
    "rawText" in (statement as Record<string, unknown>) ||
    "rawText" in (result as Record<string, unknown>);
  check(
    "no rawText field on model/result and no raw header line leaked",
    !hasRawTextField && !serialized.includes("Details of your account activity"),
  );
}

// 6. Statement period is used for date normalization (MMM DD → ISO).
{
  const result = parseStatementText(BANK_TEXT);
  const dated = result.rows.find((r) => r.date);
  check(
    "dates normalized to ISO using the statement period year",
    Boolean(dated) && /^2026-\d{2}-\d{2}$/.test(dated!.date),
    dated?.date,
  );
}

// 7. Coordinate parser can be absent and the text fallback still works.
{
  const noItems = parseStatement({ text: BANK_TEXT }); // no items
  check(
    "text fallback works with no coordinate items",
    noItems.statement.transactions.length === 2 &&
      noItems.result.parseStats?.coordinateExtractionAvailable === false,
  );
  // And when items ARE present, the coordinate source can be chosen.
  const sample = coordinateSamples.find((s) => s.name === "A-standard-bank-table")!;
  const items = buildItems(sample.rows);
  const text = groupVisualLines(items).map((l) => l.text).join("\n");
  const withItems = parseStatement({ text, items });
  check(
    "coordinate source is chosen when a clean table is present",
    withItems.result.parseStats?.chosenCandidateSource === "coordinate-table",
    withItems.result.parseStats?.chosenCandidateSource,
  );
}

// 8. Profile detection chooses a generic fallback safely.
{
  const cc = detectStatementProfile(SUMMARY_HEAVY_CC);
  const bank = detectStatementProfile(BANK_TEXT);
  const gibberish = detectStatementProfile("hello world, nothing to see here");
  check("credit-card profile detected", cc.statementKind === "credit-card");
  check("bank-account profile detected", bank.statementKind === "bank-account");
  check(
    "unknown text falls back safely (no throw, generic/unknown profile)",
    typeof gibberish.name === "string" && gibberish.confidence <= 0.3,
    gibberish.name,
  );
  check("profile names are generic layout families, not banks", STATEMENT_PROFILES.every((p) => !/^rbc$|^bmo$|^td$|^cibc$/i.test(p.name)));
}

// 9b. Coordinate header probe: sane aggregates + carries NO document text.
{
  const sample = coordinateSamples.find((s) => s.name === "A-standard-bank-table")!;
  const items = buildItems(sample.rows);
  const probe = probeCoordinateHeaders(items);
  check(
    "header probe reports sane aggregates for a clean table",
    probe.coordinateItemsPresent &&
      probe.visualLineCount > 0 &&
      probe.maxItemsPerLine > 0 &&
      probe.bestDistinctMeaningsOnALine >= 2 &&
      probe.tableRegionsFound === 1,
    JSON.stringify(probe),
  );
  const empty = probeCoordinateHeaders([]);
  check(
    "header probe is empty/safe when no coordinate items",
    !empty.coordinateItemsPresent && empty.visualLineCount === 0 && empty.tableRegionsFound === 0,
  );
  // Privacy: the probe is counts/booleans only — no document text (not even the
  // header words like "Description"/"Balance", nor any merchant/amount strings).
  const serialized = JSON.stringify(probe);
  const leakTokens = ["Payroll", "Grocery", "Coffee", "Opening", "Closing", "Description", "Balance", "Deposit", "2,200.00", "4,110.05"];
  check(
    "header probe serialization contains no document text",
    leakTokens.every((tok) => !serialized.includes(tok)),
    serialized,
  );
}

// 9. The pipeline stages are represented in code, in order.
{
  check(
    "pipeline stages enumerated A..J",
    PARSER_PIPELINE_STAGES.length === 10 &&
      PARSER_PIPELINE_STAGES[0].startsWith("A.") &&
      PARSER_PIPELINE_STAGES[PARSER_PIPELINE_STAGES.length - 1].startsWith("J."),
  );
}

console.log(
  failures === 0
    ? `\nAll architecture invariants held.`
    : `\n${failures} architecture invariant(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
