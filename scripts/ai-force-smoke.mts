// DEV-ONLY forced-AI regression smoke runner.
//
//   npm run ai:force:smoke
//   node --experimental-strip-types scripts/ai-force-smoke.mts [extra.pdf ...]
//
// Runs the forced AI full-reconstruction harness against a small configured list of
// LOCAL private statements (plus any paths passed as args), when they exist. Files
// that are absent are skipped cleanly. If OPENAI_API_KEY / AI_ASSIST_MODEL are not
// set, it prints a clear message and skips the AI calls.
//
// PRIVACY: prints SAFE AGGREGATES ONLY — file name, parser/AI row counts, AI
// difference, reconciled flag, evidence mode, image count, tokens, estimated cost,
// and the verdict label. Never row text, descriptions, prompts, responses, PDF
// text, images, or base64.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { aiAssistConfig } from "../src/lib/ai-assist.ts";
import { runForcedReconstruction, type ForcedSummary } from "./force-ai-reconstruction.mts";

// The configured regression set (by file name; resolved to local paths below).
const TARGET_FILES = [
  "credit-union-credit-card-1.pdf",
  "rbc-business-1.pdf",
  "rbc-chequing-6.pdf",
];

/** Candidate roots to search for the target files (no hard-coded user paths). */
function searchRoots(): string[] {
  const roots = new Set<string>();
  if (process.env.AI_FORCE_SMOKE_DIR) roots.add(process.env.AI_FORCE_SMOKE_DIR);
  try {
    const m = JSON.parse(readFileSync("private-test-manifest.json", "utf8")) as {
      statements?: { path?: string }[];
    };
    for (const s of m.statements ?? []) {
      if (!s.path) continue;
      let d = dirname(s.path);
      // Climb a few levels so sibling folders (e.g. credit-union/...) are covered.
      for (let i = 0; i < 3 && d && d !== dirname(d); i += 1) {
        roots.add(d);
        d = dirname(d);
      }
    }
  } catch {
    // No manifest — that's fine; rely on AI_FORCE_SMOKE_DIR / explicit args.
  }
  return [...roots].filter(Boolean);
}

/** Shallow recursive search for an exact file name under a root (bounded depth). */
function findFile(name: string, root: string, depth = 0): string | null {
  if (depth > 4 || !existsSync(root)) return null;
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (e.isFile() && e.name.toLowerCase() === name.toLowerCase()) return join(root, e.name);
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      const found = findFile(name, join(root, e.name), depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function resolveTargets(): { name: string; path: string }[] {
  const roots = searchRoots();
  const resolved: { name: string; path: string }[] = [];
  // Explicit CLI args first (exact paths).
  for (const arg of process.argv.slice(2)) {
    if (existsSync(arg)) resolved.push({ name: basename(arg), path: arg });
  }
  for (const name of TARGET_FILES) {
    let found: string | null = null;
    for (const root of roots) {
      found = findFile(name, root);
      if (found) break;
    }
    if (found) resolved.push({ name, path: found });
  }
  // De-dupe by resolved path.
  const seen = new Set<string>();
  return resolved.filter((r) => (seen.has(r.path) ? false : (seen.add(r.path), true)));
}

function printSummary(s: ForcedSummary): void {
  const f = (n: number | null) => (n === null ? "—" : n.toFixed(2));
  console.log(`\n• ${s.file}`);
  if (!s.aiConfigured) {
    console.log(`    AI not configured — parser rows: ${s.parserRows} (skipped AI). verdict: ${s.verdict}`);
    return;
  }
  console.log(`    parserRows=${s.parserRows}  aiRows=${s.aiRows ?? "—"}  aiDifference=${f(s.aiDifference)}  reconciled=${s.aiReconciled ? "yes" : "no"}`);
  console.log(`    evidenceMode=${s.evidenceMode}  inputImages=${s.inputImageCount ?? "—"}  totalTokens=${s.totalTokens ?? "—"}  estimatedCost=${s.estimatedCost}`);
  console.log(`    verdict: ${s.verdict}`);
}

async function main(): Promise<void> {
  console.log("=== Forced AI reconstruction smoke ===");
  const config = aiAssistConfig();
  if (!config.enabled) {
    console.log(`AI not configured (missing: ${config.missingConfig.join(", ") || "—"}).`);
    console.log("Set OPENAI_API_KEY + AI_ASSIST_MODEL to run the forced AI calls. Skipping AI; resolving files only.\n");
  }

  const targets = resolveTargets();
  if (targets.length === 0) {
    console.log("No configured smoke files found locally. Skipping cleanly.");
    console.log(`Looked for: ${TARGET_FILES.join(", ")}`);
    console.log("Tip: set AI_FORCE_SMOKE_DIR=<folder> or pass explicit PDF paths as arguments.");
    return;
  }

  const summaries: ForcedSummary[] = [];
  for (const t of targets) {
    try {
      summaries.push(await runForcedReconstruction(t.path, { verbose: false }));
    } catch (err) {
      const label = err instanceof Error ? err.name : "error";
      summaries.push({ file: t.name, aiConfigured: config.enabled, parserRows: 0, aiRows: null, aiDifference: null, aiReconciled: false, evidenceMode: "none", inputImageCount: null, totalTokens: null, estimatedCost: "—", verdict: `error:${label}`, error: label });
    }
  }

  console.log(`\nRan ${summaries.length} file(s):`);
  for (const s of summaries) printSummary(s);

  const passed = summaries.filter((s) => s.verdict === "independent-visual-reconstruction-passed").length;
  console.log(`\n${passed}/${summaries.length} independent visual reconstruction(s) passed.\n`);
}

main().catch((err) => {
  const label = err instanceof Error ? err.name : "error";
  console.error(`ai-force-smoke failed (${label}).`);
  process.exit(1);
});
