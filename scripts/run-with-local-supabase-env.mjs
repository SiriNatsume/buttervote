import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertLoopbackUrl } from "./local-supabase.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = path.join(ROOT, ".local", "supabase-app.env");

export function parseEnvFile(contents) {
  const values = {};
  for (const sourceLine of contents.split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    values[line.slice(0, separator).trim()] = line.slice(separator + 1);
  }
  return values;
}

function main() {
  const command = process.argv[2];
  if (!["dev", "build", "start"].includes(command)) {
    throw new Error("只允许通过本地环境运行 dev、build 或 start。");
  }
  if (!existsSync(ENV_PATH)) {
    throw new Error("尚未生成本地环境。请先运行 npm run setup:local。");
  }

  const localEnv = parseEnvFile(readFileSync(ENV_PATH, "utf8"));
  assertLoopbackUrl(localEnv.NEXT_PUBLIC_SUPABASE_URL, "本地应用 Supabase URL");

  const nextEntry = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(
    process.execPath,
    [nextEntry, command, ...process.argv.slice(3)],
    {
      cwd: ROOT,
      env: { ...process.env, ...localEnv },
      stdio: "inherit",
      windowsHide: true,
    },
  );

  child.on("error", (error) => {
    console.error(`无法启动本地 Next.js：${error.message}`);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code ?? 1;
  });
}

const isDirectRun = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isDirectRun) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
