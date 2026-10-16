import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const qqPattern = /^[1-9][0-9]{4,11}$/;

export function normalizeRoster(members, before, after) {
  if (!Array.isArray(members) || !Number.isSafeInteger(before) || before < 1 ||
    before !== after || members.length !== before || members.length > 10000) {
    throw new Error("incomplete_roster");
  }
  const seen = new Set();
  return members.map((member) => {
    if (typeof member.user_id === "number" && !Number.isSafeInteger(member.user_id)) throw new Error("incomplete_roster");
    const qq = String(member.user_id ?? "");
    if (!qqPattern.test(qq) || seen.has(qq) || typeof member.nickname !== "string" ||
      (member.card != null && typeof member.card !== "string")) throw new Error("incomplete_roster");
    seen.add(qq);
    return { qq_user_id: qq, nickname: member.nickname.slice(0, 120), card: (member.card ?? "").slice(0, 120) };
  });
}

export function readConfig(env = process.env) {
  const site = new URL(env.BUTTERVOTE_URL ?? "");
  const onebot = new URL(env.ONEBOT_HTTP_URL ?? "http://127.0.0.1:3001");
  const secret = env.BOT_API_SECRET;
  const allowedGroups = new Set((env.BUTTERVOTE_SYNC_ALLOWED_GROUPS ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  for (const url of [site, onebot]) {
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("同步地址配置无效。");
    if (url.protocol !== "https:" && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("非本机同步地址必须使用 HTTPS。");
  }
  if (!secret || allowedGroups.size === 0 || [...allowedGroups].some((g) => !qqPattern.test(g))) {
    throw new Error("请设置 BOT_API_SECRET 和 BUTTERVOTE_SYNC_ALLOWED_GROUPS。");
  }
  return { site, onebot, secret, onebotToken: env.ONEBOT_ACCESS_TOKEN, allowedGroups };
}

async function post(url, token, body, fetcher) {
  const response = await fetcher(url, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(20000),
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("sync_request_failed");
  return response.json();
}

export async function runOnce(config, fetcher = fetch) {
  const { job } = await post(new URL("/api/bot/group-sync/claim", config.site), config.secret, {}, fetcher);
  if (!job) return false;
  if (!/^[0-9a-f-]{36}$/i.test(job.id) || !/^[0-9a-f-]{36}$/i.test(job.leaseId)) throw new Error("invalid_sync_job");
  let result;
  try {
    if (!config.allowedGroups.has(job.qqGroupId)) throw new Error("group_not_allowed");
    const callBot = async (action) => {
      const value = await post(new URL(action, config.onebot.href.replace(/\/?$/, "/")), config.onebotToken,
        { group_id: Number(job.qqGroupId), no_cache: true }, fetcher);
      if (value.status !== "ok" || value.retcode !== 0) throw new Error("bot_unavailable");
      return value.data;
    };
    const before = await callBot("get_group_info");
    const members = await callBot("get_group_member_list");
    const after = await callBot("get_group_info");
    if (String(before?.group_id) !== job.qqGroupId || String(after?.group_id) !== job.qqGroupId ||
      !Array.isArray(members) || members.some((m) => String(m.group_id) !== job.qqGroupId)) throw new Error("incomplete_roster");
    result = { leaseId: job.leaseId, members: normalizeRoster(members, before.member_count, after.member_count) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "bot_unavailable";
    result = { leaseId: job.leaseId, error: ["group_not_allowed", "incomplete_roster"].includes(reason) ? reason : "bot_unavailable" };
  }
  await post(new URL(`/api/bot/group-sync/${job.id}`, config.site), config.secret, result, fetcher);
  console.log(result.error ? "群同步未完成，已保留网站原名单。" : `群同步完成：${result.members.length} 人。`);
  return true;
}

async function main() {
  const config = readConfig();
  const watch = process.argv.includes("--watch");
  do {
    try { await runOnce(config); }
    catch { console.error("同步服务暂时不可用，请检查网站和 Bot 连接。"); if (!watch) process.exitCode = 1; }
    if (watch) await delay(5000);
  } while (watch);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error("同步程序配置无效，请检查环境变量。"); process.exitCode = 1; });
}
