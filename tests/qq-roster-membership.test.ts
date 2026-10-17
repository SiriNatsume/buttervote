import assert from "node:assert/strict";
import test from "node:test";
import { formatUserGroupMembershipExpiry, getUserGroupMembershipStatus } from "../lib/user-group-membership";
import { removeQQGroupRosterSchema } from "../lib/validation/qq-group-roster";

test("permanent roster memberships remain active far into the future, but revocation wins", () => {
  const membership = { expires_at: "infinity", revoked_at: null };
  assert.equal(getUserGroupMembershipStatus(membership, new Date("2200-01-01")), "active");
  assert.equal(formatUserGroupMembershipExpiry(membership.expires_at), "长期有效");
  assert.equal(getUserGroupMembershipStatus({ ...membership, revoked_at: "2026-10-17T00:00:00Z" }), "revoked");
});

test("temporary, unset, and invalid expiries keep their existing rules", () => {
  const now = new Date("2026-10-17T00:00:00Z");
  for (const expiry of [null, "invalid", "-infinity", "2026-10-16T00:00:00Z", now.toISOString()]) {
    assert.equal(getUserGroupMembershipStatus({ expires_at: expiry, revoked_at: null }, now), "expired");
  }
  assert.equal(getUserGroupMembershipStatus({ expires_at: "2026-10-18T00:00:00Z", revoked_at: null }, now), "active");
  assert.notEqual(formatUserGroupMembershipExpiry("2026-10-18T00:00:00Z"), "长期有效");
});

test("single and multiple removals require explicit QQs and deduplicate selections", () => {
  const userGroupId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  assert.deepEqual(removeQQGroupRosterSchema.parse({ userGroupId, mode: "selected", qqUserIds: ["12345", "67890", "12345"] }).qqUserIds,
    ["12345", "67890"]);
  for (const qqUserIds of [[], ["openid"], ["12345 OR 1=1"], [12345]]) {
    assert.equal(removeQQGroupRosterSchema.safeParse({ userGroupId, mode: "selected", qqUserIds }).success, false);
  }
});

test("remove all is explicit, scoped to one valid user group, and cannot mix with selections", () => {
  const fields = { userGroupId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", mode: "all", qqUserIds: [] };
  assert.equal(removeQQGroupRosterSchema.safeParse(fields).success, true);
  assert.equal(removeQQGroupRosterSchema.safeParse({ ...fields, qqUserIds: ["12345"] }).success, false);
  assert.equal(removeQQGroupRosterSchema.safeParse({ ...fields, userGroupId: "" }).success, false);
  assert.equal(removeQQGroupRosterSchema.safeParse({ ...fields, mode: "" }).success, false);
});
