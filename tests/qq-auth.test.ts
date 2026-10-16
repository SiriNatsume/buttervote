import assert from "node:assert/strict";
import test from "node:test";
import { qqEmailAddress, qqEmailVerifySchema, rosterResultSchema } from "../lib/validation/qq-auth";

test("QQ email recipient is derived from the number; aliases and recipient overrides cannot claim a QQ", () => {
  assert.equal(qqEmailAddress(" 123456789 "), "123456789@qq.com");
  for (const invalid of ["012345", "123456@qq.com", "name", "12345\r\nBcc:x@example.com", "1e8", "１２３４５"]) {
    assert.throws(() => qqEmailAddress(invalid));
  }
  const parsed = qqEmailVerifySchema.parse({ qq: "123456789", code: "01234567", email: "attacker@qq.com", profileId: "forged" });
  assert.deepEqual(parsed, { qq: "123456789", code: "01234567" });
  assert.equal(qqEmailVerifySchema.safeParse({ qq: "123456789", code: "012345" }).success, false);
});

test("sync accepts a complete nonempty snapshot or a failure, never both", () => {
  const leaseId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  assert.equal(rosterResultSchema.safeParse({ leaseId, members: [] }).success, false);
  assert.equal(rosterResultSchema.safeParse({ leaseId, error: "bot_unavailable", members: [{ qq_user_id: "12345", nickname: "a", card: "" }] }).success, false);
  assert.equal(rosterResultSchema.safeParse({ leaseId, error: "bot_unavailable" }).success, true);
});
