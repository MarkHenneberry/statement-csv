// Report-only private corpus runner (safe aggregates ONLY).
//
//   node --experimental-strip-types scripts/private-corpus-report.mts
//
// Unlike scripts/private-parser-regression.mts (the green baseline that must
// PASS), this runner NEVER fails the build — it prints aggregate telemetry to
// track progress on still-failing / new statements. It scans a local, gitignored
// corpus folder (PRIVATE_CORPUS_DIR env, or the default below) and/or a gitignored
// private-target-manifest.json.
//
// PRIVACY: prints only safe aggregates — a GENERIC label (folder + index, never
// the filename, which can embed account fragments), statement kind, chosen
// candidate source, coordinate region/stitch counts, row counts, balance status,
// and reconciliation differences. It NEVER prints raw extracted text, names,
// addresses, account numbers, merchants, or transaction rows. Run a raw debug
// dump only behind an explicit local flag that writes to the gitignored
// private-debug/ folder (not implemented here on purpose).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { extractPdfText } from "../src/lib/pdf-extract-core.ts";
import { parseStatementText } from "../src/lib/parser.ts";
import { parseCoordinateTables, probeCoordinateHeaders } from "../src/lib/coordinate-table.ts";
import { computeBalanceCheck } from "../src/lib/upload.ts";

const DEFAULT_DIR = "C:/dev/statementcsv-private-test-files";
const ROOT = process.env.PRIVATE_CORPUS_DIR ?? DEFAULT_DIR;

if (!existsSync(ROOT)) {
  console.log(`No private corpus at ${ROOT} (set PRIVATE_CORPUS_DIR) — skipping (this is fine).`);
  process.exit(0);
}

/** Recursively collect PDF paths (sorted) without printing any names. */
function collectPdfs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectPdfs(full));
    else if (/\.pdf$/i.test(entry)) out.push(full);
  }
  return out.sort();
}

const pdfs = collectPdfs(ROOT);
if (pdfs.length === 0) {
  console.log(`No PDFs under ${ROOT} — nothing to report.`);
  process.exit(0);
}

// Group by folder so the label is the folder + an index (never the filename).
const byFolder = new Map<string, string[]>();
for (const p of pdfs) {
  const folder = relative(ROOT, p).split(/[\\/]/).slice(0, -1).join("/") || ".";
  const arr = byFolder.get(folder);
  if (arr) arr.push(p);
  else byFolder.set(folder, [p]);
}

let coordWins = 0;
let total = 0;

for (const [folder, files] of [...byFolder.entries()].sort()) {
  for (let i = 0; i < files.length; i += 1) {
    total += 1;
    const label = `${folder}#${i}`;
    try {
      const ex = await extractPdfText(new Uint8Array(readFileSync(files[i])));
      const probe = probeCoordinateHeaders(ex.items);
      const cands = parseCoordinateTables(ex.items, 2026);
      const parsed = parseStatementText(ex.pages.join("\n"), ex.items);
      const mode = parsed.statementKind === "credit-card" ? "credit-card" : "bank-account";
      const check = computeBalanceCheck(
        parsed.openingBalance,
        parsed.closingBalance,
        parsed.rows,
        mode,
      );
      const source = parsed.parseStats?.chosenCandidateSource ?? "?";
      if (source === "coordinate-table") coordWins += 1;
      const stitched = cands.find((c) => c.diagnostics.stitched);
      const stReconcile = stitched
        ? computeBalanceCheck(stitched.opening, stitched.closing, stitched.rows, mode).passed
        : null;
      console.log(
        `${label}: kind=${parsed.statementKind} chosen=${source} regions=${probe.tableRegionsFound} ` +
          `stitchTried=${probe.stitchCandidatesTried} relaxed=${probe.stitchRelaxedCompatibilityUsed} ` +
          `reject=${JSON.stringify(probe.stitchRejectReasons)} rows=${parsed.rows.length} ` +
          `balance=${check.passed ? "passed" : check.available ? "needs-review" : "limited"} ` +
          `diff=${check.difference ?? "n/a"} coordStitchedReconciles=${stReconcile ?? "n/a"}`,
      );
    } catch (err) {
      console.log(`${label}: ERROR ${err instanceof Error ? err.message : "unknown"}`);
    }
  }
}

console.log(`\nReport only (never fails). ${coordWins}/${total} parsed via the coordinate engine.`);
process.exit(0);
