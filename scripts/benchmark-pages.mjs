import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: {
  base: { type: "string", default: "http://127.0.0.1:3000" },
  path: { type: "string", multiple: true },
  runs: { type: "string", default: "5" },
  output: { type: "string" },
} });
const base = new URL(values.base);
const runs = Number(values.runs);
if (!Number.isSafeInteger(runs) || runs < 1 || runs > 50) {
  throw new Error("--runs must be an integer between 1 and 50.");
}
if (!["http:", "https:"].includes(base.protocol)) throw new Error("Use an HTTP(S) base URL.");
const headers = process.env.BUTTERVOTE_BENCHMARK_COOKIE
  ? { cookie: process.env.BUTTERVOTE_BENCHMARK_COOKIE }
  : {};
const percentile = (samples, fraction) => {
  const ordered = [...samples].sort((a, b) => a - b);
  return Math.round(ordered[Math.ceil(ordered.length * fraction) - 1]);
};
const results = [];
for (const path of values.path ?? ["/", "/login", "/hall-of-fame"]) {
  const url = new URL(path, base);
  if (url.origin !== base.origin) throw new Error("All paths must use the base origin.");
  const samples = [];
  // Exclude one warm-up from the report so module initialization is separated
  // from the repeat-visit measurements. No concurrent load is generated.
  for (let index = 0; index <= runs; index++) {
    const start = performance.now();
    const response = await fetch(url, { headers, redirect: "manual" });
    const firstByteMs = performance.now() - start;
    const body = await response.arrayBuffer();
    const completeMs = performance.now() - start;
    if (index > 0) samples.push({
      firstByteMs, completeMs, bytes: body.byteLength, status: response.status,
    });
  }
  results.push({
    path: url.pathname + url.search,
    firstByteMedianMs: percentile(samples.map((sample) => sample.firstByteMs), 0.5),
    firstByteP95Ms: percentile(samples.map((sample) => sample.firstByteMs), 0.95),
    completeMedianMs: percentile(samples.map((sample) => sample.completeMs), 0.5),
    completeP95Ms: percentile(samples.map((sample) => sample.completeMs), 0.95),
    statuses: [...new Set(samples.map((sample) => sample.status))],
    samples,
  });
}
const report = { base: base.origin, runs, signedIn: Boolean(headers.cookie), results };
if (values.output) await writeFile(values.output, JSON.stringify(report, null, 2) + "\n");
console.table(results, ["path", "firstByteMedianMs", "firstByteP95Ms", "completeMedianMs", "completeP95Ms", "statuses"]);
