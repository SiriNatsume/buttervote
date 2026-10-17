import "server-only";

import { createRequiredServiceClient } from "@/lib/supabase/service";
import { getUserGroupMembershipDays } from "@/lib/permissions/user-groups";
import { getProfileAvatarUrl } from "@/lib/qq-profile-display";

export async function getCachedQQProfileDisplay(qq: string) {
  const { data, error } = await createRequiredServiceClient().rpc("get_qq_profile_display", { p_qq_user_id: qq });
  // Display enrichment must not prevent the existing login flow.
  return error ? null : data?.[0] ?? null;
}

// Only call with a bot-authenticated identity or an email returned by verifyOtp.
export async function resolveQQProfile(qq: string, options: {
  verifiedAuthUserId?: string;
  nickname?: string | null;
  avatarUrl?: string | null;
} = {}) {
  const { data, error } = await createRequiredServiceClient().rpc("resolve_qq_profile", {
    p_qq_user_id: qq,
    p_verified_auth_user_id: options.verifiedAuthUserId ?? null,
    p_nickname: options.nickname ?? null,
    p_avatar_url: getProfileAvatarUrl({ qq_user_id: qq, qq_avatar_url: options.avatarUrl }),
  });
  if (error || !data) throw new Error(error?.message ?? "QQ_ACCOUNT_UNAVAILABLE");
  return data;
}

export async function syncQQProfileMemberships(profileId: string, joinCodes: string[] = []) {
  const { error } = await createRequiredServiceClient().rpc("sync_qq_profile_memberships", {
    p_profile_id: profileId,
    p_join_codes: [...new Set(joinCodes)],
    p_days: Math.min(90, Math.max(1, Math.floor(getUserGroupMembershipDays()))),
  });
  if (error) throw new Error("QQ_MEMBERSHIPS_UNAVAILABLE");
}
