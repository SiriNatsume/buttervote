import { formatDateTime } from "@/lib/time";

export type UserGroupMembershipStatus = "active" | "expired" | "revoked";
export const PERMANENT_MEMBERSHIP_EXPIRY = "infinity";

export function getUserGroupMembershipStatus(
  membership: { expires_at: string | null; revoked_at: string | null },
  now = new Date(),
): UserGroupMembershipStatus {
  if (membership.revoked_at) return "revoked";
  if (membership.expires_at === PERMANENT_MEMBERSHIP_EXPIRY) return "active";
  if (!membership.expires_at) return "expired";
  return new Date(membership.expires_at).getTime() > now.getTime() ? "active" : "expired";
}

export function formatUserGroupMembershipExpiry(expiresAt: string | null): string {
  return expiresAt === PERMANENT_MEMBERSHIP_EXPIRY ? "长期有效" : formatDateTime(expiresAt);
}
