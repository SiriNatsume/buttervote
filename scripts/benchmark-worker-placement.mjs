import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";
import path from "node:path";
import { performance } from "node:perf_hooks";

const root = process.cwd();
const id = randomUUID().slice(0, 8);
const directory = path.join(root, ".local", `placement-${id}`);
const token = randomBytes(32).toString("hex");
const paths = process.argv.slice(2).filter((value) => value.startsWith("/") && !value.startsWith("//"));
if (!paths.length || paths.some((value) => !/^\/(?:$|groups\/[0-9a-f-]+(?:\/results)?$|contests\/[0-9a-f-]+(?:\/results)?$)/i.test(value))) {
  throw new Error("Provide explicit public homepage, group or contest paths; no actions/API/private routes are permitted.");
}
mkdirSync(directory, { recursive: true });
const config = JSON.parse(readFileSync(path.join(root, "wrangler.jsonc"), "utf8"));
const variants = ["edge", "sg"].map((kind) => ({ kind, name: `buttervote-placement-${kind}-${id}`, config: path.join(directory, `${kind}.json`) }));
const samples = [];
const cleanupFailures = [];
const report = { paths, samples, cleanupFailures, method: "Alternating guest full HTML through service bindings to the same deployed vote-site; 3 warmups and 12 measured pairs per path. clientMs includes forwarding latency; no production secrets or user cookies." };
const p = (values, quantile) => [...values].sort((a,b) => a-b)[Math.max(0, Math.ceil(values.length*quantile)-1)];
function wrangler(args) {
  const result = spawnSync(process.execPath, [path.join(root, "node_modules/wrangler/bin/wrangler.js"), ...args], {
    cwd: root, encoding: "utf8", env: { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH}`, WRANGLER_SEND_METRICS: "false" },
  });
  if (result.status !== 0) throw new Error(`Wrangler ${args[0]} failed: ${String(result.stderr).split("\n").filter(line=>!line.includes("PROBE_TOKEN")&&!line.includes(token)).slice(-8).join("\n")}`);
  return result.stdout;
}

try {
  for (const variant of variants) {
    const workerConfig = {
      name: variant.name, account_id: "159b98d5c619713392c48fa388404d0c",
      main: path.join(root, "scripts/performance/placement-probe-worker.mjs"), compatibility_date: "2026-05-12",
      workers_dev: true, preview_urls: false, services: [{ binding: "APP", service: config.name }],
      vars: { PROBE_TOKEN: token, PROBE_PATHS: JSON.stringify(paths) },
      ...(variant.kind === "sg" ? { placement: { region: "aws:ap-southeast-1" } } : {}),
    };
    writeFileSync(variant.config, JSON.stringify(workerConfig), { mode: 0o600 });
    const output = wrangler(["deploy", "--config", variant.config]);
    variant.url = output.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/i)?.[0];
    if (!variant.url) throw new Error("Wrangler did not return the temporary Worker URL");
    console.log(`Temporary ${variant.kind} probe ready`);
  }
  for (let index = 0; index < paths.length; index += 1) {
    for (let run = -3; run < 12; run += 1) {
      const ordered = run % 2 === 0 ? variants : [...variants].reverse();
      const pair = [];
      for (const variant of ordered) {
        const start = performance.now();
        const response = await fetch(`${variant.url}?case=${index}`, {
          headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60000), redirect: "error",
        });
        if (!response.ok) throw new Error(`Probe failed: ${response.status}`);
        const data = await response.json();
        const sample = { ...data, clientMs: performance.now()-start, kind: variant.kind, path: paths[index], placement: response.headers.get("cf-placement") };
        if (sample.status !== 200 || !sample.bytes) throw new Error(`Application returned ${sample.status}`);
        if (variant.kind === "sg" && !sample.placement?.includes("SIN")) throw new Error(`Singapore execution was not confirmed: ${sample.placement}`);
        pair.push(sample);
        if (run >= 0) samples.push(sample);
      }
      if (pair[0].headingHash !== pair[1].headingHash) throw new Error("Public headings differed between placement variants");
    }
    const summary = variants.map(({kind}) => {
      const scoped = samples.filter(sample=>sample.path===paths[index]&&sample.kind===kind);
      return {kind, p50ClientMs:Math.round(p(scoped.map(s=>s.clientMs),.5)),p95ClientMs:Math.round(p(scoped.map(s=>s.clientMs),.95)),p50RenderMs:Math.round(p(scoped.map(s=>s.elapsedMs),.5)),placement:[...new Set(scoped.map(s=>s.placement))]};
    });
    console.log(JSON.stringify({path:paths[index],summary}));
  }
} finally {
  // Names contain this run's random ID; no pre-existing Worker is ever deleted.
  for (const variant of variants) {
    try { wrangler(["delete", "--name", variant.name, "--force"]); }
    catch { cleanupFailures.push(variant.name); }
    rmSync(variant.config, { force: true }); // remove the temporary token
  }
  writeFileSync(path.join(directory, "report.json"), JSON.stringify(report, null, 2));
  console.log(`Report: ${path.relative(root, directory)}/report.json`);
  if (cleanupFailures.length) console.error("Temporary Worker cleanup failed:", cleanupFailures.join(", "));
}
