import assert from "node:assert/strict";
import test from "node:test";
import { getProfileAvatarUrl, getProfileDisplayName, getQQAvatarUrl, getQQTicketNickname } from "../lib/qq-profile-display";

test("numeric QQ identities use the matching QQ avatar even when the Bot omitted or supplied another avatar", () => {
  const expected = "https://q1.qlogo.cn/g?b=qq&nk=12345678&s=100";
  assert.equal(getQQAvatarUrl(" 12345678 "), expected);
  assert.equal(getProfileAvatarUrl({ qq_user_id: "12345678", qq_avatar_url: null }), expected);
  assert.equal(getProfileAvatarUrl({ qq_user_id: "12345678", qq_avatar_url: "https://other.example/avatar.jpg" }), expected);
  for (const qq of ["012345", "1234", "openid", "12345&nk=other", "123456@qq.com", null]) assert.equal(getQQAvatarUrl(qq), null);
});

test("old login links cannot restore a nickname older than an already observed QQ update", () => {
  const ticket = { qq_nickname: "旧昵称", created_at: "2026-10-17T10:00:00Z" };
  const cached = { nickname: "更新后的QQ昵称", observed_at: "2026-10-17T11:00:00Z" };
  assert.equal(getQQTicketNickname(ticket, cached), "更新后的QQ昵称");
  assert.equal(getQQTicketNickname({ ...ticket, created_at: "2026-10-17T12:00:00Z" }, cached), "旧昵称");
  assert.equal(getQQTicketNickname({ ...ticket, qq_nickname: "" }, cached), "更新后的QQ昵称");
  assert.equal(getQQTicketNickname(ticket, null), "旧昵称");
});

test("QQ nickname is preferred consistently over the old site name and numeric email", () => {
  const profile = { qq_user_id: "12345678", qq_nickname: "  真正的 QQ 昵称  ", display_name: "旧站内名称", email: "12345678@qq.com" };
  assert.equal(getProfileDisplayName(profile), "真正的 QQ 昵称");
  assert.equal(getProfileDisplayName({ ...profile, qq_nickname: "" }), "旧站内名称");
  assert.equal(getProfileDisplayName({ ...profile, qq_nickname: null, display_name: null }), "QQ 用户 5678");
});

test("non-QQ accounts keep their own names; an email address alone does not claim a QQ avatar", () => {
  assert.equal(getProfileDisplayName({ display_name: "普通邮箱用户", email: "user@example.com" }), "普通邮箱用户");
  assert.equal(getProfileDisplayName({ email: "user@example.com" }), "user@example.com");
  assert.equal(getProfileDisplayName(null, "未知用户"), "未知用户");
  assert.equal(getProfileAvatarUrl({ email: "12345678@qq.com" }), null);
});

test("legacy opaque identities retain safe provided avatars, while executable and credential-bearing URLs are rejected", () => {
  assert.equal(getProfileAvatarUrl({ qq_user_id: "openid", qq_avatar_url: "https://thirdqq.qlogo.cn/avatar" }), "https://thirdqq.qlogo.cn/avatar");
  for (const avatar of ["javascript:alert(1)", "data:image/svg+xml,test", "http://example.com/a.png", "https://token:secret@example.com/a.png", "not-a-url"]) {
    assert.equal(getProfileAvatarUrl({ qq_user_id: "openid", qq_avatar_url: avatar }), null);
  }
});
