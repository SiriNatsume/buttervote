// End-to-end against the LOCAL app, real local Auth/Postgres/Mailpit and a
// loopback OneBot fixture. Never reads or writes a hosted Supabase project.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { assertLoopbackUrl } from "./local-supabase.mjs";
import { readConfig, runOnce } from "./qq-group-sync.mjs";

const api = assertLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
const base = assertLoopbackUrl(process.env.QQ_AUTH_TEST_BASE_URL ?? "http://127.0.0.1:3000", "测试网站");
const mail = assertLoopbackUrl(process.env.QQ_AUTH_TEST_MAIL_URL ?? "http://127.0.0.1:54324", "测试邮箱");
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(api.href, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const anon = createClient(api.href, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
const suffix = String(Date.now()).slice(-7);
const qq = `80${suffix}`;
const otherQQ = `81${suffix}`;
const lateQQ = `82${suffix}`;
const groupQQ = `83${suffix}`;
const raceQQ = `84${suffix}`;
const conflictQQ = `85${suffix}`;
const legacyPasswordQQ = `86${suffix}`;
const freshQQ = `87${suffix}`;
const headers = { "Content-Type": "application/json", Origin: base.origin };
const password = `ButterVote${suffix}!`;
const resetPassword = `ButterVoteReset${suffix}!`;
const botHeaders = { ...headers, Authorization: `Bearer ${process.env.BOT_API_SECRET}` };
let checks = 0;
function passed(message) { checks++; console.log(`PASS ${message}`); }
async function value(result, label) {
  const { data, error } = await result;
  assert.equal(error, null, `${label}: ${error?.message}`);
  return data;
}
async function post(path, body, extraHeaders = headers) {
  return fetch(new URL(path, base), { method: "POST", headers: extraHeaders, body: JSON.stringify(body), redirect: "manual" });
}
async function legacyAuthCookie(email, secret) {
  let saved = [];
  const auth = createServerClient(api.href, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: { getAll: () => saved, setAll: (items) => { saved = items; } },
  });
  await value(auth.auth.signInWithPassword({ email, password: secret }), "local legacy Auth cookie");
  const cookie = saved.filter((item) => item.value).map((item) => `${item.name}=${item.value}`).join("; ");
  assert.ok(cookie);
  return { cookie, auth };
}
async function profileForCookie(cookie) {
  assert.ok(cookie, "app session cookie is set");
  const token = decodeURIComponent(cookie.split(";")[0].split("=").slice(1).join("="));
  return value(service.from("app_sessions").select("profile_id,expires_at").eq("session_token_hash", createHash("sha256").update(token).digest("hex")).single(), "lookup session");
}
async function botLogin(number) {
  const generated = await post("/api/bot/qq-login-link", { qqUserId: number, qqNickname: "本地测试用户" }, botHeaders);
  assert.equal(generated.status, 200);
  const ticketUrl = new URL((await generated.json()).url);
  const preview = await fetch(ticketUrl);
  assert.equal(preview.status, 200);
  const response = await fetch(ticketUrl, { method: "POST", headers: { Origin: base.origin, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: ticketUrl.searchParams.get("token") }), redirect: "manual" });
  assert.ok([303, 307].includes(response.status));
  const cookie = response.headers.get("set-cookie");
  const session = await profileForCookie(cookie);
  const reused = await fetch(ticketUrl, { redirect: "manual" });
  assert.match(reused.headers.get("location"), /qq_ticket_used/);
  return { cookie, profileId: session.profile_id };
}
async function readCode(number, subject) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const inbox = await (await fetch(new URL("/api/v1/messages", mail))).json();
    const message = inbox.messages?.find((m) => m.To?.some((recipient) => recipient.Address === `${number}@qq.com`) && (!subject || m.Subject?.includes(subject)));
    if (message) {
      const detail = await (await fetch(new URL(`/api/v1/message/${message.ID}`, mail))).json();
      const text = detail.Text || detail.HTML;
      const code = text?.match(/(?:^|\D)(\d{8})(?:\D|$)/)?.[1];
      assert.ok(code, "local email contains the eight digit OTP template");
      return code;
    }
    await delay(500);
  }
  throw new Error("Local test email was not delivered.");
}
async function emailLogin(number, returnTo = "/me/groups") {
  const sent = await post("/api/auth/qq-email/start", { qq: number });
  const delivery = await sent.json();
  assert.equal(sent.status, 200, delivery.error);
  assert.ok(["register", "setup"].includes(delivery.step), "accounts without a chosen password must verify their mailbox");
  assert.equal(sent.headers.get("set-cookie"), null, "discovery and sending do not log in");
  if (delivery.step === "register") {
    assert.equal((await value(service.from("profiles").select("id").eq("qq_user_id", number), "unverified account")).length, 0);
  }
  const code = await readCode(number);
  const credentials = { password, confirmPassword: password };
  const incorrect = await post("/api/auth/qq-email/verify", { qq: number, code: code === "00000000" ? "99999999" : "00000000", ...credentials });
  assert.equal(incorrect.status, 400);
  assert.equal(incorrect.headers.get("set-cookie"), null);
  const verified = await post("/api/auth/qq-email/verify", { qq: number, code, returnTo, ...credentials });
  const result = await verified.json();
  assert.equal(verified.status, 200, result.error);
  const cookie = verified.headers.get("set-cookie");
  const session = await profileForCookie(cookie);
  return { cookie, profileId: session.profile_id, code, result, step: delivery.step };
}

const admin = await value(service.from("profiles").select("id").eq("email", "admin@buttervote.local").single(), "local admin");
const first = await botLogin(qq);
const contest = await value(service.from("contests").insert({ title: "QQ 身份一致性测试", status: "voting", vote_type: "single", created_by: admin.id }).select("id").single(), "contest");
const candidate = await value(service.from("candidates").insert({ contest_id: contest.id, name: "测试候选" }).select("id").single(), "candidate");
const voteId = await value(service.rpc("submit_vote_with_love", { p_contest_id: contest.id, p_voter_id: first.profileId, p_payload: { candidateId: candidate.id }, p_love_candidate_ids: [] }), "vote");
const email = await emailLogin(qq, `/contests/${contest.id}/vote`);
assert.equal(email.profileId, first.profileId);
assert.equal(email.result.redirectTo, `/contests/${contest.id}/vote`);
assert.equal((await value(service.from("votes").select("id").eq("contest_id", contest.id).eq("voter_id", email.profileId).single(), "original vote")).id, voteId);
const duplicate = await service.rpc("submit_vote_with_love", { p_contest_id: contest.id, p_voter_id: email.profileId, p_payload: { candidateId: candidate.id }, p_love_candidate_ids: [] });
assert.ok(duplicate.error, "same QQ cannot vote again through email login");
passed("Bot → 邮箱：复用同一 profile 和原投票，重复投票被拒绝");

// Exercise the returning/confirmed Auth identity path as well as first-use
// confirmation codes. This is only a local synthetic fixture.
await value(service.auth.admin.createUser({ email: `${otherQQ}@qq.com`, email_confirm: true, user_metadata: { qq_password_set: true } }), "confirmed Auth fixture");
const oldOtpState = await value(service.rpc("get_qq_email_account_state", { p_qq_user_id: otherQQ }), "old OTP account state");
assert.equal(oldOtpState[0].has_password, false, "Auth-generated password and user-editable metadata do not indicate a chosen password");
const emailFirst = await emailLogin(otherQQ);
assert.doesNotMatch(emailFirst.cookie, /max-age=|expires=/i, "unchecked remember uses a browser-session cookie");
const botSecond = await botLogin(otherQQ);
assert.equal(emailFirst.profileId, botSecond.profileId);
assert.equal((await value(service.from("profiles").select("id").eq("qq_user_id", otherQQ), "unique profile")).length, 1);
passed("邮箱 → Bot：仍只有一个投票账号");

const discovered = await post("/api/auth/qq-email/start", { qq: otherQQ });
assert.deepEqual(await discovered.json(), { ok: true, step: "password" });
assert.equal(discovered.headers.get("set-cookie"), null);
const wrongPassword = await post("/api/auth/qq-email/password", { qq: otherQQ, password: "incorrect-password" });
assert.equal(wrongPassword.status, 400);
assert.equal(wrongPassword.headers.get("set-cookie"), null);
const remembered = await post("/api/auth/qq-email/password", { qq: otherQQ, password, remember: true, returnTo: "https://example.com" });
assert.equal(remembered.status, 200);
assert.equal((await remembered.json()).redirectTo, "/");
assert.match(remembered.headers.get("set-cookie"), /max-age=/i);
assert.equal((await profileForCookie(remembered.headers.get("set-cookie"))).profile_id, emailFirst.profileId);
passed("已注册 QQ 自动进入密码登录；错误密码不登录，记住密码设置持久会话且禁止外站跳转");

// Do not wait for the resend cooldown in this synthetic LOCAL fixture.
await value(service.from("qq_email_rate_limits").delete().eq("key", `send:minute:${createHash("sha256").update(otherQQ).digest("hex")}`), "clear local cooldown");
const resetSent = await post("/api/auth/qq-email/send", { qq: otherQQ, purpose: "reset" });
assert.equal(resetSent.status, 200, `reset send failed: ${await resetSent.text()}`);
assert.equal(resetSent.headers.get("set-cookie"), null);
const recoveryCode = await readCode(otherQQ, "重设密码");
const missingPassword = await post("/api/auth/qq-email/verify", { qq: otherQQ, code: recoveryCode, purpose: "reset" });
assert.equal(missingPassword.status, 400);
assert.equal(missingPassword.headers.get("set-cookie"), null);
const resetFields = { qq: otherQQ, purpose: "reset", code: recoveryCode, password: resetPassword, confirmPassword: resetPassword };
const reset = await post("/api/auth/qq-email/verify", resetFields);
assert.equal(reset.status, 200, `reset failed: ${await reset.text()}`);
const resetSession = await profileForCookie(reset.headers.get("set-cookie"));
assert.equal(resetSession.profile_id, emailFirst.profileId);
const priorSessions = await value(service.from("app_sessions").select("revoked_at").eq("profile_id", emailFirst.profileId).is("revoked_at", null), "reset sessions");
assert.equal(priorSessions.length, 1, "reset revokes existing Bot and web sessions");
assert.equal((await post("/api/auth/qq-email/password", { qq: otherQQ, password })).status, 400);
assert.equal((await post("/api/auth/qq-email/password", { qq: otherQQ, password: resetPassword })).status, 200);
assert.equal((await post("/api/auth/qq-email/verify", resetFields)).status, 400, "recovery code is one-use");
passed("QQ 邮箱验证码重设密码：需新密码、沿用原账号、旧密码失效、撤销旧会话、验证码不可重放");

const fresh = await emailLogin(freshQQ);
assert.equal(fresh.step, "register");
const freshState = await value(service.rpc("get_qq_email_account_state", { p_qq_user_id: freshQQ }), "new password state");
assert.equal(freshState[0].has_password, true);
const temporary = await profileForCookie(fresh.cookie);
const remaining = new Date(temporary.expires_at).getTime() - Date.now();
assert.ok(remaining > 11.9 * 3600000 && remaining <= 12 * 3600000);
passed("全新 QQ 自动发码，验证并设密码后创建账号；未记住密码的服务端会话最长 12 小时");

const oldPasswordAuth = await value(service.auth.admin.createUser({ email: `${legacyPasswordQQ}@qq.com`, password: "Old12345", email_confirm: true }), "legacy password fixture");
await value(service.from("profiles").insert({ id: oldPasswordAuth.user.id, email: `${legacyPasswordQQ}@qq.com`, display_name: "旧密码测试" }), "legacy password profile");
const legacyStart = await post("/api/auth/qq-email/start", { qq: legacyPasswordQQ });
assert.deepEqual(await legacyStart.json(), { ok: true, step: "password" });
const legacyLogin = await post("/api/auth/qq-email/password", { qq: legacyPasswordQQ, password: "Old12345" });
assert.equal(legacyLogin.status, 200);
assert.equal((await profileForCookie(legacyLogin.headers.get("set-cookie"))).profile_id, oldPasswordAuth.user.id);
passed("原邮箱密码账号保留原密码和 profile");

const qqAuthOnly = await legacyAuthCookie(`${legacyPasswordQQ}@qq.com`, "Old12345");
const bypass = await fetch(new URL("/me/groups", base), { headers: { Cookie: qqAuthOnly.cookie }, redirect: "manual" });
if (bypass.status === 307) {
  assert.match(bypass.headers.get("location"), /\/login/);
} else {
  // A Server Component redirect after streaming starts is encoded in HTML.
  assert.equal(bypass.status, 200);
  assert.match(await bypass.text(), /NEXT_REDIRECT;replace;\/login|http-equiv="refresh" content="0;url=\/login/);
}
await qqAuthOnly.auth.auth.signOut({ scope: "local" });
const adminAuth = await legacyAuthCookie("admin@buttervote.local", "ButterVoteAdmin123!");
const legacyAdmin = await fetch(new URL("/admin", base), { headers: { Cookie: adminAuth.cookie }, redirect: "manual" });
assert.equal(legacyAdmin.status, 200, "other email accounts retain their legacy login");
await adminAuth.auth.auth.signOut({ scope: "local" });
passed("QQ 账号不能用残留 Auth cookie 绕过网站会话，其他邮箱管理员仍可正常登录");

const racedAuth = await value(service.auth.admin.createUser({ email: `${raceQQ}@qq.com`, email_confirm: true }), "concurrent Auth fixture");
const racedIds = await Promise.all(Array.from({ length: 8 }, (_, index) => value(service.rpc("resolve_qq_profile", {
  p_qq_user_id: raceQQ,
  ...(index % 2 ? { p_verified_auth_user_id: racedAuth.user.id } : {}),
}), "concurrent QQ profile")));
assert.equal(new Set(racedIds).size, 1);
assert.equal((await value(service.from("profiles").select("id").eq("qq_user_id", raceQQ), "concurrent profile count")).length, 1);
passed("Bot/邮箱并发首次登录仍只生成一个投票账号");

const oldQQId = await value(service.rpc("resolve_qq_profile", { p_qq_user_id: conflictQQ }), "old QQ fixture");
const oldAuth = await value(service.auth.admin.createUser({ email: `${conflictQQ}@qq.com`, email_confirm: true }), "old email fixture");
await value(service.from("profiles").insert({ id: oldAuth.user.id, email: `${conflictQQ}@qq.com`, display_name: "历史邮箱账号" }), "old email profile");
const conflict = await service.rpc("resolve_qq_profile", { p_qq_user_id: conflictQQ, p_verified_auth_user_id: oldAuth.user.id });
assert.match(conflict.error?.message ?? "", /QQ_IDENTITY_CONFLICT/);
const preserved = await value(service.from("profiles").select("id").in("id", [oldQQId, oldAuth.user.id]), "preserved conflicting profiles");
assert.equal(preserved.length, 2);
passed("历史独立账号冲突会停止绑定，保留两边记录");

const reusedCode = await post("/api/auth/qq-email/verify", { qq, code: email.code, password, confirmPassword: password, purpose: "reset" });
assert.equal(reusedCode.status, 400);
assert.equal((await post("/api/auth/qq-email/send", { qq })).status, 409, "registration cannot overwrite an existing password");
assert.equal((await post("/api/auth/qq-email/send", { qq: "alias@qq.com" })).status, 400);
assert.equal((await post("/api/auth/qq-email/send", { qq }, { ...headers, Origin: "https://example.com" })).status, 403);
for (const path of ["start", "password", "verify"]) {
  assert.equal((await post(`/api/auth/qq-email/${path}`, { qq }, { ...headers, Origin: "https://example.com" })).status, 403);
}
assert.equal((await post("/api/bot/group-sync/claim", {})).status, 401);
const publicSignup = await anon.auth.signUp({ email: `unwanted${suffix}@example.com`, password: randomUUID() });
assert.ok(publicSignup.error, "public signup remains disabled");
passed("验证码不可重放，别名和跨站请求被拒绝，普通注册保持关闭");

const group = await value(service.from("user_groups").insert({ name: `本地同步测试 ${suffix}` }).select("id").single(), "user group");
const forbidden = await service.rpc("request_qq_group_sync", { p_user_group_id: group.id, p_qq_group_id: groupQQ, p_admin_id: first.profileId });
assert.ok(forbidden.error);
for (const table of ["qq_group_roster", "qq_group_sync_jobs", "qq_group_sync_configs"]) {
  assert.ok((await anon.from(table).select("*")).error);
}
assert.ok((await anon.rpc("resolve_qq_profile", { p_qq_user_id: qq })).error);
assert.ok((await anon.rpc("get_qq_email_account_state", { p_qq_user_id: qq })).error);
passed("群名单和身份解析仅服务端可访问，普通用户不能提交同步任务");

let roster = [qq, otherQQ, lateQQ].map((q) => ({ group_id: Number(groupQQ), user_id: Number(q), nickname: "本地测试成员", card: "测试群名片" }));
let incomplete = false;
const bot = createServer(async (req, res) => {
  for await (const chunk of req) { /* consume request without logging credentials */ }
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ status: "ok", retcode: 0, data: req.url === "/get_group_info"
    ? { group_id: Number(groupQQ), member_count: roster.length + (incomplete ? 1 : 0) }
    : roster }));
});
await new Promise((resolve) => bot.listen(0, "127.0.0.1", resolve));
const config = readConfig({ BUTTERVOTE_URL: base.origin, ONEBOT_HTTP_URL: `http://127.0.0.1:${bot.address().port}`,
  BOT_API_SECRET: process.env.BOT_API_SECRET, BUTTERVOTE_SYNC_ALLOWED_GROUPS: groupQQ });
async function sync() {
  await value(service.rpc("request_qq_group_sync", { p_user_group_id: group.id, p_qq_group_id: groupQQ, p_admin_id: admin.id }), "request sync");
  await runOnce(config);
}
async function membership(id) {
  return value(service.from("user_group_members").select("source,expires_at,last_verified_at,revoked_at").eq("user_group_id", group.id).eq("profile_id", id).single(), "membership");
}
try {
  await sync();
  assert.equal((await membership(first.profileId)).revoked_at, null);
  assert.equal((await value(service.from("qq_group_roster").select("qq_user_id").eq("user_group_id", group.id), "roster")).length, 3);
  assert.equal((await value(service.from("profiles").select("id").eq("qq_user_id", lateQQ), "unclaimed member")).length, 0);
  // Simulate a previously requested but not yet entered confirmation code.
  await value(service.auth.admin.createUser({ email: `${lateQQ}@qq.com`, email_confirm: false }), "unconfirmed Auth fixture");
  const claimed = await emailLogin(lateQQ);
  const originalMembership = await membership(claimed.profileId);
  assert.equal(originalMembership.revoked_at, null);
  assert.equal(originalMembership.expires_at, "infinity");
  await value(service.rpc("sync_qq_profile_memberships", { p_profile_id: claimed.profileId, p_days: 7 }), "re-login memberships");
  assert.equal((await membership(claimed.profileId)).expires_at, originalMembership.expires_at);
  passed("同步完整名单，未注册成员验证邮箱后获得长期资格；重复登录保留长期资格");

  incomplete = true;
  await sync();
  assert.equal((await value(service.from("qq_group_roster").select("qq_user_id").eq("user_group_id", group.id), "preserved roster")).length, 3);
  passed("不完整 Bot 返回不会覆盖原名单");
  incomplete = false;
  await value(service.from("user_group_members").update({ source: "manual", revoked_at: new Date().toISOString() }).eq("user_group_id", group.id).eq("profile_id", claimed.profileId), "manual revoke");
  roster = roster.filter((member) => String(member.user_id) !== qq);
  await sync();
  assert.equal((await membership(first.profileId)).revoked_at, null);
  assert.equal((await membership(first.profileId)).expires_at, "infinity");
  assert.ok((await membership(claimed.profileId)).revoked_at);
  passed("后续群名单缺少成员不撤销长期资格，手动撤销不会被重新同步恢复");

  const job = await value(service.rpc("request_qq_group_sync", { p_user_group_id: group.id, p_qq_group_id: groupQQ, p_admin_id: admin.id }), "lease test request");
  const active = await value(service.rpc("claim_qq_group_sync_job"), "claim lease");
  assert.equal(await value(service.rpc("finish_qq_group_sync_job", { p_job_id: job, p_lease_id: randomUUID(), p_error: "test" }), "wrong lease"), false);
  await value(service.rpc("finish_qq_group_sync_job", { p_job_id: job, p_lease_id: active[0].lease_id, p_error: "本地测试完成" }), "finish lease");
  passed("错误租约无法提交同步结果");
} finally {
  await new Promise((resolve) => bot.close(resolve));
}
console.log(`QQ 登录与群同步本地端到端测试通过：${checks} 组。`);
