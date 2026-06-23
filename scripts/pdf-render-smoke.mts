// PDF render smoke test — prove the server-side PDF→image backend works.
//
//   node --experimental-strip-types scripts/pdf-render-smoke.mts "C:\\path\\to\\file.pdf"
//
// Renders a page + at least one targeted crop and writes the PNGs to the
// gitignored private-debug/render-smoke/ folder. Prints ONLY safe metadata
// (backend, counts, dimensions, output paths, failure reason) — never PDF text,
// transaction data, names, accounts, merchants, or statement content.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  selectVisionRegions,
  renderVisionEvidence,
  probeRenderBackend,
} from "../src/lib/pdf-render.ts";

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.log('usage: node --experimental-strip-types scripts/pdf-render-smoke.mts "<pdf path>"');
  process.exit(0);
}
if (!existsSync(pdfPath)) {
  console.log("render succeeded: no");
  console.log("render failure reason: file-not-found");
  process.exit(0);
}

function pngDims(buf: Uint8Array): string {
  const read = (o: number) => ((buf[o] << 24) | (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3]) >>> 0;
  return `${read(16)}x${read(20)}`;
}

const probe = await probeRenderBackend();
console.log(`backend: ${probe.backend ?? "(none)"}`);
console.log(`backend available: ${probe.available ? "yes" : "no"}${probe.reason ? ` (${probe.reason})` : ""}`);

const bytes = new Uint8Array(readFileSync(pdfPath));
const regions = selectVisionRegions({ pageCount: 3, hasLowConfidence: true });
console.log(`pages attempted: ${new Set(regions.map((r) => r.page)).size}`);

const rendered = await renderVisionEvidence(bytes, regions, { enabled: true });
console.log(`render succeeded: ${rendered.available ? "yes" : "no"}`);
if (!rendered.available) {
  console.log(`render failure reason: ${rendered.failureReason ?? "unknown"}`);
  process.exit(0);
}

const outDir = "private-debug/render-smoke";
mkdirSync(outDir, { recursive: true });
const paths: string[] = [];
for (const img of rendered.images) {
  const b64 = img.dataUrl.split(",")[1] ?? "";
  const buf = Buffer.from(b64, "base64");
  const file = `${outDir}/${img.id}.png`;
  writeFileSync(file, buf);
  paths.push(`${file}  [${img.crop ? "crop" : "full-page"} ${pngDims(buf)}]`);
}

console.log(`images created: ${rendered.images.length}`);
console.log(`crop count: ${rendered.crops}`);
console.log(`full-page count: ${rendered.fullPages}`);
console.log("output paths (gitignored):");
for (const p of paths) console.log(`  ${p}`);
process.exit(0);
