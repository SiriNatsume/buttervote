import assert from "node:assert/strict";
import test from "node:test";
import { newPasswordSchema, qqEmailAddress, qqEmailSendSchema, qqEmailVerifySchema, qqPasswordLoginSchema, rosterResultSchema } from "../lib/validation/qq-auth";

test("QQ email recipient is derived from the number; aliases and recipient overrides cannot claim a QQ", () => {
  assert.equal(qqEmailAddress(" 123456789 "), "123456789@qq.com");
  for (const invalid of ["012345", "123456@qq.com", "name", "12345\r\nBcc:x@example.com", "1e8", "１２３４５"]) {
    assert.throws(() => qqEmailAddress(invalid));
  }
  const parsed = qqEmailVerifySchema.parse({ qq: "123456789", code: "01234567", password: "test123456", confirmPassword: "test123456", email: "attacker@qq.com", profileId: "forged" });
  assert.deepEqual(parsed, { qq: "123456789", code: "01234567", password: "test123456", confirmPassword: "test123456", purpose: "register", remember: false });
  assert.equal(qqEmailVerifySchema.safeParse({ qq: "123456789", code: "012345" }).success, false);
});

test("mail verification requires a matching new password; old OTP-only requests cannot log in", () => {
  const fields = { qq: "123456789", code: "01234567", password: "secret123", confirmPassword: "secret123" };
  assert.equal(qqEmailVerifySchema.safeParse({ qq: fields.qq, code: fields.code }).success, false);
  assert.equal(qqEmailVerifySchema.safeParse({ ...fields, password: "short", confirmPassword: "short" }).success, false);
  assert.equal(qqEmailVerifySchema.safeParse({ ...fields, confirmPassword: "different" }).success, false);
  assert.equal(qqEmailVerifySchema.safeParse({ ...fields, purpose: "reset", remember: true }).success, true);
  assert.equal(qqEmailSendSchema.safeParse({ qq: fields.qq, purpose: "login" }).success, false);
  assert.equal(qqEmailVerifySchema.safeParse({ ...fields, remember: "true" }).success, false);
});

test("password limits count UTF-8 bytes without trimming; existing short passwords can still log in", () => {
  assert.equal(newPasswordSchema.safeParse("a".repeat(72)).success, true);
  assert.equal(newPasswordSchema.safeParse("a".repeat(73)).success, false);
  assert.equal(newPasswordSchema.safeParse("密".repeat(24)).success, true);
  assert.equal(newPasswordSchema.safeParse("密".repeat(25)).success, false);
  assert.equal(newPasswordSchema.parse("  pass123  "), "  pass123  ");
  const login = qqPasswordLoginSchema.parse({ qq: "123456789", password: "old123" });
  assert.equal(login.password, "old123");
  assert.equal(login.remember, false);
});

test("sync accepts a complete nonempty snapshot or a failure, never both", () => {
  const leaseId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  assert.equal(rosterResultSchema.safeParse({ leaseId, members: [] }).success, false);
  assert.equal(rosterResultSchema.safeParse({ leaseId, error: "bot_unavailable", members: [{ qq_user_id: "12345", nickname: "a", card: "" }] }).success, false);
  assert.equal(rosterResultSchema.safeParse({ leaseId, error: "bot_unavailable" }).success, true);
});
