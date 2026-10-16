import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRoster, readConfig, runOnce } from "../scripts/qq-group-sync.mjs";

const member = { user_id: 12345, group_id: 54321, nickname: "测试用户", card: "群名片" };
test("partial, duplicate, changing or malformed member lists cannot replace the roster", () => {
  assert.deepEqual(normalizeRoster([member], 1, 1), [{ qq_user_id: "12345", nickname: "测试用户", card: "群名片" }]);
  for (const args of [[[], 0, 0], [[member], 2, 2], [[member], 1, 2], [[member, member], 2, 2], [[{ ...member, user_id: "opaque-openid" }], 1, 1]]) {
    assert.throws(() => normalizeRoster(...args), /incomplete_roster/);
  }
});
test("bridge enforces a configured allowlist and protects secrets from remote cleartext URLs", () => {
  assert.throws(() => readConfig({ BUTTERVOTE_URL: "http://example.com", BOT_API_SECRET: "test", BUTTERVOTE_SYNC_ALLOWED_GROUPS: "54321" }));
  assert.throws(() => readConfig({ BUTTERVOTE_URL: "https://example.com", BOT_API_SECRET: "test" }));
});
test("a failed bot fetch is reported without publishing a partial snapshot", async () => {
  const config = readConfig({ BUTTERVOTE_URL: "http://localhost:3000", BOT_API_SECRET: "test", BUTTERVOTE_SYNC_ALLOWED_GROUPS: "54321" });
  const calls = [];
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  await runOnce(config, async (url, options) => {
    calls.push([String(url), JSON.parse(options.body)]);
    if (String(url).endsWith("/claim")) return Response.json({ job: { id, leaseId: id, qqGroupId: "54321" } });
    if (String(url).includes("3001")) return Response.json({ status: "failed", retcode: 1, data: null });
    return Response.json({ ok: true });
  });
  assert.deepEqual(calls.at(-1)[1], { leaseId: id, error: "bot_unavailable" });
  assert.equal(calls.length, 3);
});
