// AI Assist smoke test — confirm OpenAI is reachable BEFORE testing statements.
//
//   node --experimental-strip-types scripts/ai-assist-smoke.mts
//
// Loads .env.local (Next does this automatically for the app; this standalone
// script does not, so we parse it here), checks config, and makes a tiny harmless
// ping with NO statement data. Prints only safe status — never the key, never
// statement content. Always exits 0 (it is a diagnostic, not a gate): when no key
// is configured it reports "configured: no" and skips the call.

import { existsSync, readFileSync } from "node:fs";
import { aiAssistConfig, callOpenAiChat } from "../src/lib/ai-assist.ts";

// Minimal .env.local loader (no dependency). Does not overwrite existing env.
function loadEnvLocal(path = ".env.local"): void {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvLocal();

const config = aiAssistConfig();
const configured = config.hasKey && Boolean(config.model);

console.log(`configured: ${configured ? "yes" : "no"}`);
console.log(`model: ${config.model ?? "(none)"}`);
console.log(`enabled: ${config.enabled ? "yes" : "no"}`);
if (config.missingConfig.length) {
  console.log(`missing: ${config.missingConfig.join(", ")}`);
}

if (!configured) {
  console.log("call succeeded: skipped (not configured)");
  console.log("\nSet OPENAI_API_KEY and AI_ASSIST_MODEL in .env.local to test the call.");
  process.exit(0);
}

// Harmless ping — NO statement data, no schema, tiny output.
const res = await callOpenAiChat(
  [{ role: "user", content: "Reply with the single word: ok" }],
  config,
  { maxTokens: 5 },
);

console.log(`call succeeded: ${res.ok ? "yes" : "no"}`);
if (!res.ok) {
  console.log(`error label: ${res.errorLabel ?? "unknown"}`);
  console.log("\nThe call did not succeed. Common causes: invalid AI_ASSIST_MODEL name,");
  console.log("invalid/expired key (http-401), no access to the model (http-403/404),");
  console.log("rate limit (http-429), or no network (network-error/timeout).");
}
// Never print res.content (model output) or the key.
process.exit(0);
