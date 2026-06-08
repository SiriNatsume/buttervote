import "server-only";

import { requireUser } from "@/lib/auth";
import { getEnvNumber } from "@/lib/security/token";
import { createServerDataClient } from "@/lib/supabase/server-data";
import type {
  ContestGroupAccessMode,
  Profile,
  UserGroup,
  UserGroupMember,
} from "@/lib/types";

export type UserGroupMembershipWithGroup = UserGroupMember & {
  user_group: Pick<UserGroup, "id" | "name" | "description" | "join_code"> | null;
};

export type UserGroupMembershipStatus = "active" | "expired" | "revoked";

export function getUserGroupMembershipDays() {
  return getEnvNumber("USER_GROUP_MEMBERSHIP_DAYS", 7);
}

export function getUserGroupMembershipExpiresAt(from = new Date()) {
  return new Date(
    from.getTime() + getUserGroupMembershipDays() * 24 * 60 * 60 * 1000,
  );
}

export function getUserGroupMembershipStatus(
  membership: Pick<UserGroupMember, "expires_at" | "revoked_at">,
  now = new Date(),
): UserGroupMembershipStatus {
  if (membership.revoked_at) {
    return "revoked";
  }

  if (!membership.expires_at) {
    return "expired";
  }

  return new Date(membership.expires_at).getTime() > now.getTime()
    ? "active"
    : "expired";
}

export async function getEffectiveUserGroupIds(
  profileId: string,
): Promise<string[]> {
  const supabase = await createServerDataClient();
  const { data } = await supabase
    .from("user_group_members")
    .select("user_group_id")
    .eq("profile_id", profileId)
    .is("revoked_at", null)
    .not("expires_at", "is", null)
    .gt("expires_at", new Date().toISOString());

  return (data ?? []).map((membership) => membership.user_group_id);
}

export async function getUserGroupMemberships(
  profileId: string,
): Promise<UserGroupMembershipWithGroup[]> {
  const supabase = await createServerDataClient();
  const { data: memberships } = await supabase
    .from("user_group_members")
    .select(
      "id,user_group_id,profile_id,source,joined_at,last_verified_at,expires_at,revoked_at",
    )
    .eq("profile_id", profileId)
    .order("joined_at", { ascending: false });

  const userGroupIds = [
    ...new Set((memberships ?? []).map((membership) => membership.user_group_id)),
  ];

  const { data: userGroups } =
    userGroupIds.length > 0
      ? await supabase
          .from("user_groups")
          .select("id,name,description,join_code")
          .in("id", userGroupIds)
      : { data: [] };
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

  const { data: allowedRows } = await supabase
    .from("contest_group_allowed_user_groups")
    .select("user_group_id")
    .eq("contest_group_id", params.contestGroupId);

  const allowedUserGroupIds = new Set(
    (allowedRows ?? []).map((row) => row.user_group_id),
  );

  if (allowedUserGroupIds.size === 0) {
    return false;
  }

  const effectiveUserGroupIds = await getEffectiveUserGroupIds(params.profile.id);
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
