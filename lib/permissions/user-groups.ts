import "server-only";

import { cache } from "react";
import { requireUser } from "@/lib/auth";
import { getEnvNumber } from "@/lib/security/token";
import { createServerDataClient } from "@/lib/supabase/server-data";
import { fetchAllRows, fetchRowsByIds } from "@/lib/supabase-pagination";
import type {
  ContestGroupAccessMode,
  Profile,
  UserGroup,
  UserGroupMember,
} from "@/lib/types";

export type UserGroupMembershipWithGroup = UserGroupMember & {
  user_group: Pick<UserGroup, "id" | "name" | "description" | "join_code"> | null;
};

export { getUserGroupMembershipStatus, type UserGroupMembershipStatus } from "@/lib/user-group-membership";

export function getUserGroupMembershipDays() {
  return getEnvNumber("USER_GROUP_MEMBERSHIP_DAYS", 7);
}

export function getUserGroupMembershipExpiresAt(from = new Date()) {
  return new Date(
    from.getTime() + getUserGroupMembershipDays() * 24 * 60 * 60 * 1000,
  );
}

export const getEffectiveUserGroupIds = cache(async (
  profileId: string,
): Promise<string[]> => {
  const supabase = await createServerDataClient();
  const { data, error } = await fetchAllRows(() => supabase
    .from("user_group_members")
    .select("user_group_id", { count: "exact" })
    .eq("profile_id", profileId)
    .is("revoked_at", null)
    .not("expires_at", "is", null)
    .gt("expires_at", new Date().toISOString()).order("id"));
  if (error) throw new Error("无法读取用户组资格，请重试。");

  return (data ?? []).map((membership) => membership.user_group_id);
});

export async function getUserGroupMemberships(
  profileId: string,
): Promise<UserGroupMembershipWithGroup[]> {
  const supabase = await createServerDataClient();
  const { data: memberships, error: membershipError } = await fetchAllRows(() => supabase
    .from("user_group_members")
    .select(
      "id,user_group_id,profile_id,source,joined_at,last_verified_at,expires_at,revoked_at",
    )
    .eq("profile_id", profileId)
    .order("joined_at", { ascending: false }).order("id"));
  if (membershipError) throw new Error("无法读取用户组成员身份，请重试。");

  const userGroupIds = [
    ...new Set((memberships ?? []).map((membership) => membership.user_group_id)),
  ];

  const { data: userGroups, error: groupsError } = await fetchRowsByIds(userGroupIds, (batch) => supabase
          .from("user_groups")
          .select("id,name,description,join_code")
          .in("id", batch).order("id"));
  if (groupsError) throw new Error("无法读取用户组资料，请重试。");
  const userGroupById = new Map(
    (userGroups ?? []).map((userGroup) => [userGroup.id, userGroup]),
  );

  return (memberships ?? []).map((membership) => ({
    ...membership,
    user_group: userGroupById.get(membership.user_group_id) ?? null,
  }));
}

export async function canParticipateContestGroup(params: {
  contestGroupId: string;
  profile: Profile | null;
}): Promise<boolean> {
  const supabase = await createServerDataClient();
  const { data: group } = await supabase
    .from("contest_groups")
    .select("id,access_mode")
    .eq("id", params.contestGroupId)
    .maybeSingle();

  if (!group || !params.profile) {
    return false;
  }

  const accessMode = group.access_mode as ContestGroupAccessMode;
  if (accessMode !== "restricted") {
    return true;
  }

  if (params.profile.role === "admin") {
    return true;
  }

  const [{ data: allowedRows, error: allowedError }, effectiveUserGroupIds] = await Promise.all([
    fetchAllRows(() => supabase
    .from("contest_group_allowed_user_groups")
    .select("user_group_id", { count: "exact" })
    .eq("contest_group_id", params.contestGroupId).order("id")),
    getEffectiveUserGroupIds(params.profile.id),
  ]);
  if (allowedError) throw new Error("无法读取活动组允许的用户组，请重试。");

  const allowedUserGroupIds = new Set(
    (allowedRows ?? []).map((row) => row.user_group_id),
  );

  if (allowedUserGroupIds.size === 0) {
    return false;
  }

  return effectiveUserGroupIds.some((userGroupId) =>
    allowedUserGroupIds.has(userGroupId),
  );
}

export async function requireContestGroupParticipation(groupId: string) {
  const profile = await requireUser();
  const canParticipate = await canParticipateContestGroup({
    contestGroupId: groupId,
    profile,
  });

  if (!canParticipate) {
    throw new Error("你暂时没有参与该活动组投票的权限。");
  }

  return profile;
}
