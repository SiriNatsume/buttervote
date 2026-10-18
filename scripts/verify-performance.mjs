import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseArgs } from "node:util";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const statePath = path.join(ROOT, ".local", "page-performance", "fixture.json");
const { values } = parseArgs({ options: { pages: { type: "boolean", default: false } } });

function run(script, ...args) {
  const result = spawnSync(process.execPath, [
    "--import", "tsx", path.join(ROOT, "scripts", "performance", script), ...args,
  ], { cwd: ROOT, stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${script} exited with ${result.status ?? result.signal}`);
}

if (existsSync(statePath)) {
  throw new Error("已有性能测试清单，请先运行 node --import tsx scripts/performance/fixture.mjs cleanup 并确认清理完成，再删除该清单。");
}
mkdirSync(path.dirname(statePath), { recursive: true });

try {
  // Every helper independently rejects non-loopback Supabase URLs. Each
  // fixture has a recorded random ID and an ownership check before cleanup.
  run("fixture.mjs", "seed");
  run("verify-db.mjs");
  if (values.pages) run("verify-pages.mjs");
} finally {
  if (existsSync(statePath)) {
    run("fixture.mjs", "cleanup");
    unlinkSync(statePath);
  }
}
