import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GENERATED_ROOT = path.join(ROOT, ".local", "supabase-project");
const GENERATED_SUPABASE = path.join(GENERATED_ROOT, "supabase");
const GENERATED_MIGRATIONS = path.join(GENERATED_SUPABASE, "migrations");
const APP_ENV_PATH = path.join(ROOT, ".local", "supabase-app.env");
const BASELINE_MIGRATION = "202605100000_initial_schema.sql";
const LOCAL_ADMIN = {
  email: "admin@buttervote.local",
  password: "ButterVoteAdmin123!",
  displayName: "本地管理员",
  role: "admin",
};
const LOCAL_USER = {
  email: "user@buttervote.local",
  password: "ButterVoteUser123!",
  displayName: "本地用户",
  role: "user",
};

function requireFile(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`缺少本地 Supabase 所需文件：${path.relative(ROOT, filePath)}`);
  }
}

function assertInsideGeneratedRoot(targetPath) {
  const relative = path.relative(GENERATED_ROOT, targetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("拒绝写入本地 Supabase 生成目录之外的路径。");
  }
}

export function prepareLocalSupabaseWorkdir() {
  const configSource = path.join(ROOT, "supabase", "local", "config.toml");
  const serviceRoleSource = path.join(
    ROOT,
    "supabase",
    "local",
    "service-role.sql",
  );
  const schemaSource = path.join(ROOT, "supabase", "schema.sql");
  const seedSource = path.join(ROOT, "supabase", "seed.sql");
  const migrationsSource = path.join(ROOT, "supabase", "migrations");

  requireFile(configSource);
  requireFile(serviceRoleSource);
  requireFile(schemaSource);
  requireFile(seedSource);
  requireFile(migrationsSource);
  assertInsideGeneratedRoot(GENERATED_SUPABASE);
  assertInsideGeneratedRoot(GENERATED_MIGRATIONS);

  mkdirSync(GENERATED_SUPABASE, { recursive: true });
  rmSync(GENERATED_MIGRATIONS, { recursive: true, force: true });
  mkdirSync(GENERATED_MIGRATIONS, { recursive: true });

  copyFileSync(configSource, path.join(GENERATED_SUPABASE, "config.toml"));
  copyFileSync(seedSource, path.join(GENERATED_SUPABASE, "seed.sql"));
  copyFileSync(
    serviceRoleSource,
    path.join(GENERATED_SUPABASE, "service-role.sql"),
  );
  copyFileSync(
    schemaSource,
    path.join(GENERATED_MIGRATIONS, BASELINE_MIGRATION),
  );

  const migrationNames = readdirSync(migrationsSource)
    .filter((name) => /^\d+_[a-z0-9_]+\.sql$/i.test(name))
    .sort();

  for (const migrationName of migrationNames) {
    copyFileSync(
      path.join(migrationsSource, migrationName),
      path.join(GENERATED_MIGRATIONS, migrationName),
    );
  }

  return {
    generatedRoot: GENERATED_ROOT,
    baselineMigration: BASELINE_MIGRATION,
    migrationNames,
  };
}

function redactSecrets(value) {
  return String(value ?? "")
    .replace(/sb_secret_[A-Za-z0-9._-]+/g, "[LOCAL_SECRET_REDACTED]")
    .replace(/eyJ[A-Za-z0-9._-]{40,}/g, "[LOCAL_JWT_REDACTED]")
    .replace(
      /(SERVICE_ROLE_KEY|SECRET_KEY|ANON_KEY|PUBLISHABLE_KEY)\s*[:=]\s*\S+/gi,
      "$1=[REDACTED]",
    );
}

function runCommand(command, args, { capture = false, allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    windowsHide: true,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0 && !allowFailure) {
    const details = redactSecrets(`${result.stdout ?? ""}\n${result.stderr ?? ""}`).trim();
    throw new Error(details || `${command} 执行失败，退出码 ${result.status}。`);
  }

  return result;
}

function runSupabase(args, options) {
  const cliEntry = path.join(ROOT, "node_modules", "supabase", "dist", "supabase.js");
  requireFile(cliEntry);
  return runCommand(process.execPath, [cliEntry, ...args], options);
}

function ensureDockerIsRunning() {
  const result = runCommand(
    "docker",
    ["info", "--format", "{{.ServerVersion}}"],
    { capture: true, allowFailure: true },
  );

  if (result.status !== 0) {
    throw new Error("Docker 尚未运行。请先启动 Docker Desktop，再重新执行此命令。");
  }
}

function flattenStatus(value, prefix = "", output = new Map()) {
  if (!value || typeof value !== "object") {
    return output;
  }

  for (const [key, child] of Object.entries(value)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "string") {
      output.set(fullKey.toLowerCase().replace(/[^a-z0-9]/g, ""), child);
      output.set(key.toLowerCase().replace(/[^a-z0-9]/g, ""), child);
    } else {
      flattenStatus(child, fullKey, output);
    }
  }

  return output;
}

export function parseSupabaseStatus(rawStatus) {
  const firstBrace = rawStatus.indexOf("{");
  const lastBrace = rawStatus.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new Error("无法解析 Supabase 本地状态输出。");
  }

  const status = JSON.parse(rawStatus.slice(firstBrace, lastBrace + 1));
  const flattened = flattenStatus(status);
  const pick = (...keys) => {
    for (const key of keys) {
      const value = flattened.get(key.toLowerCase().replace(/[^a-z0-9]/g, ""));
      if (value) return value;
    }
    return null;
  };

  const apiUrl = pick("API_URL", "api.url");
  const publicKey = pick("ANON_KEY", "PUBLISHABLE_KEY", "auth.anon_key");
  const serviceKey = pick(
    "SERVICE_ROLE_KEY",
    "SECRET_KEY",
    "auth.service_role_key",
  );

  if (!apiUrl || !publicKey || !serviceKey) {
    throw new Error("Supabase 本地状态缺少 API URL、公开 key 或 service key。");
  }

  return {
    apiUrl,
    publicKey,
    serviceKey,
    studioUrl: pick("STUDIO_URL", "studio.url"),
    mailUrl: pick("INBUCKET_URL", "MAILPIT_URL", "local_smtp.url"),
  };
}

export function assertLoopbackUrl(value, label = "Supabase URL") {
  const parsed = new URL(value);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) {
    throw new Error(`${label} 不是本机回环地址，已拒绝继续：${parsed.origin}`);
  }
  return parsed;
}

function readLocalStatus() {
  const result = runSupabase(
    ["status", "--output", "json", "--workdir", GENERATED_ROOT],
    { capture: true },
  );
  const status = parseSupabaseStatus(result.stdout ?? "");
  assertLoopbackUrl(status.apiUrl);
  return status;
}

export function buildLocalAppEnv(status) {
  assertLoopbackUrl(status.apiUrl);
  return [
    "# Generated by npm run setup:local. Do not commit this file.",
    `NEXT_PUBLIC_SUPABASE_URL=${status.apiUrl}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${status.publicKey}`,
    `SUPABASE_SERVICE_ROLE_KEY=${status.serviceKey}`,
    "CRON_SECRET=butter-vote-local-cron-secret",
    "BOT_API_SECRET=butter-vote-local-bot-secret",
    "APP_SESSION_COOKIE_NAME=butter_vote_local_session",
    "APP_SESSION_DAYS=30",
    "QQ_LOGIN_TICKET_TTL_MINUTES=5",
    "USER_GROUP_MEMBERSHIP_DAYS=7",
    "NEXT_PUBLIC_SITE_URL=http://localhost:3000",
    "",
  ].join("\n");
}

function writeLocalAppEnv(status) {
  mkdirSync(path.dirname(APP_ENV_PATH), { recursive: true });
  writeFileSync(APP_ENV_PATH, buildLocalAppEnv(status), "utf8");
}

async function createLocalUser(client, account) {
  const { data, error } = await client.auth.admin.createUser({
    email: account.email,
    password: account.password,
    email_confirm: true,
    user_metadata: { display_name: account.displayName },
  });

  if (error || !data.user) {
    throw new Error(`创建本地账号 ${account.email} 失败：${error?.message ?? "未知错误"}`);
  }

  const { error: profileError } = await client
    .from("profiles")
    .update({
      display_name: account.displayName,
      role: account.role,
    })
    .eq("id", data.user.id);

  if (profileError) {
    throw new Error(`设置本地账号 ${account.email} 失败：${profileError.message}`);
  }

  return data.user;
}

async function seedLocalAccountsAndVotes(status) {
  assertLoopbackUrl(status.apiUrl);
  const client = createClient(status.apiUrl, status.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = await createLocalUser(client, LOCAL_ADMIN);
  const user = await createLocalUser(client, LOCAL_USER);

  const { error: votesError } = await client.from("votes").upsert(
    [
      {
        id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
        contest_id: "11111111-1111-1111-1111-111111111111",
        voter_id: admin.id,
        payload: { candidateId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1" },
        created_at: "2026-01-01T08:00:00.000Z",
      },
      {
        id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
        contest_id: "11111111-1111-1111-1111-111111111111",
        voter_id: user.id,
        payload: { candidateId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2" },
        created_at: "2026-01-01T08:01:00.000Z",
      },
    ],
    { onConflict: "contest_id,voter_id" },
  );

  if (votesError) {
    throw new Error(`写入本地示例投票失败：${votesError.message}`);
  }

  const requiredTables = [
    "contests",
    "contest_groups",
    "candidates",
    "votes",
    "tournaments",
    "tournament_draw_logs",
    "tournament_matches",
    "contest_calling_sessions",
    "contest_calling_events",
  ];
  for (const table of requiredTables) {
    const { error } = await client.from(table).select("id").limit(1);
    if (error) {
      throw new Error(`验证本地表 ${table} 失败：${error.message}`);
    }
  }

  const { data: buckets, error: bucketsError } = await client.storage.listBuckets();
  if (bucketsError) {
    throw new Error(`验证本地 Storage 失败：${bucketsError.message}`);
  }
  if (!buckets.some((bucket) => bucket.id === "vote-images")) {
    throw new Error("本地 Storage 缺少 vote-images bucket。");
  }
}

function startLocalSupabase() {
  console.log("正在启动本地 Supabase...");
  runSupabase(["start", "--workdir", GENERATED_ROOT], { capture: true });
}

async function resetLocalSupabase() {
  console.log("正在从基础 schema 和全部 migrations 重建本地数据库...");
  runSupabase(
    ["db", "reset", "--local", "--workdir", GENERATED_ROOT, "--yes"],
    { capture: true },
  );
  const status = readLocalStatus();
  writeLocalAppEnv(status);
  await seedLocalAccountsAndVotes(status);
  return status;
}

function printReady(status) {
  console.log("本地 Supabase 已就绪。");
  console.log(`API：${status.apiUrl}`);
  if (status.studioUrl) console.log(`Studio：${status.studioUrl}`);
  if (status.mailUrl) console.log(`本地邮箱：${status.mailUrl}`);
  console.log(`管理员：${LOCAL_ADMIN.email} / ${LOCAL_ADMIN.password}`);
  console.log(`普通用户：${LOCAL_USER.email} / ${LOCAL_USER.password}`);
  console.log("运行 npm run dev:local 启动网站。");
}

function createMigration(name) {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name ?? "")) {
    throw new Error("请提供仅包含字母、数字、短横线或下划线的 migration 名称。");
  }

  const { migrationNames } = prepareLocalSupabaseWorkdir();
  const before = new Set([BASELINE_MIGRATION, ...migrationNames]);
  runSupabase(["migration", "new", name, "--workdir", GENERATED_ROOT], {
    capture: true,
  });
  const created = readdirSync(GENERATED_MIGRATIONS).filter(
    (fileName) => fileName.endsWith(".sql") && !before.has(fileName),
  );

  if (created.length !== 1) {
    throw new Error("Supabase CLI 未生成唯一 migration 文件。");
  }

  const destination = path.join(ROOT, "supabase", "migrations", created[0]);
  copyFileSync(path.join(GENERATED_MIGRATIONS, created[0]), destination);
  console.log(`已创建 supabase/migrations/${created[0]}`);
}

async function main() {
  const command = process.argv[2] ?? "setup";

  if (command === "prepare") {
    const prepared = prepareLocalSupabaseWorkdir();
    console.log(`已准备基础 migration + ${prepared.migrationNames.length} 个现有 migrations。`);
    return;
  }

  if (command === "migration-new") {
    createMigration(process.argv[3]);
    return;
  }

  if (command === "stop") {
    prepareLocalSupabaseWorkdir();
    runSupabase(["stop", "--workdir", GENERATED_ROOT], { capture: true });
    console.log("本地 Supabase 已停止，数据卷已保留。");
    return;
  }

  prepareLocalSupabaseWorkdir();
  ensureDockerIsRunning();

  if (command === "status") {
    printReady(readLocalStatus());
    return;
  }

  if (command === "start") {
    startLocalSupabase();
    const status = readLocalStatus();
    writeLocalAppEnv(status);
    printReady(status);
    return;
  }

  if (command === "reset") {
    startLocalSupabase();
    const status = await resetLocalSupabase();
    printReady(status);
    return;
  }

  if (command === "setup") {
    startLocalSupabase();
    const status = await resetLocalSupabase();
    printReady(status);
    return;
  }

  throw new Error(`未知命令：${command}`);
}

const isDirectRun = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isDirectRun) {
  main().catch((error) => {
    console.error(`本地 Supabase 操作失败：${redactSecrets(error instanceof Error ? error.message : error)}`);
    process.exitCode = 1;
  });
}

export const localSupabasePaths = {
  root: ROOT,
  generatedRoot: GENERATED_ROOT,
  generatedMigrations: GENERATED_MIGRATIONS,
  appEnv: APP_ENV_PATH,
  baselineMigration: BASELINE_MIGRATION,
};
