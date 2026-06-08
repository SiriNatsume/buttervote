"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActionAdmin } from "@/lib/auth";
import { getUserGroupMembershipExpiresAt } from "@/lib/permissions/user-groups";
import { createServerDataClient } from "@/lib/supabase/server-data";
import type { ContestGroupAccessMode } from "@/lib/types";

type ActionResult<T extends Record<string, unknown> = Record<string, unknown>> =
  | ({ ok: true; message?: string } & T)
  | { ok: false; error: string };

type UserGroupInput = {
  name: unknown;
  description?: unknown;
  join_code?: unknown;
};

type ContestGroupAccessInput = {
  accessMode: unknown;
  allowedUserGroupIds?: unknown;
};

const joinCodeSchema = z
  .string()
  .trim()
  .min(1, "入组代码不能为空")
  .max(80, "入组代码不能超过 80 个字符")
  .regex(/^[A-Za-z0-9_-]+$/, "入组代码只能包含字母、数字、下划线和短横线");

const userGroupSchema = z.object({
  name: z.string().trim().min(1, "用户组名称不能为空").max(160),
  description: z.string().trim().max(1000).optional(),
  join_code: joinCodeSchema.optional(),
});

const userGroupIdSchema = z.object({
  userGroupId: z.string().uuid(),
});

const memberIdSchema = z.object({
  memberId: z.string().uuid(),
});

const contestGroupAccessSchema = z.object({
  groupId: z.string().uuid(),
  accessMode: z.enum(["public", "restricted"]),
  allowedUserGroupIds: z.array(z.string().uuid()).default([]),
});

function actionSuccess<T extends Record<string, unknown> = Record<string, unknown>>(
  message?: string,
  extra?: T,
): ActionResult<T> {
  return { ok: true, ...(message ? { message } : {}), ...(extra ?? ({} as T)) };
}

function actionFailure(message: string): ActionResult {
  return { ok: false, error: message };
}

function optionalText(value: unknown) {
  const text = String(value ?? "").trim();
  return text ? text : undefined;
}

function normalizeUserGroupInput(data: FormData | UserGroupInput) {
  if (data instanceof FormData) {
    return {
      name: data.get("name"),
      description: optionalText(data.get("description")),
      join_code: optionalText(data.get("join_code")),
    };
  }

  return {
    name: data.name,
    description: optionalText(data.description),
    join_code: optionalText(data.join_code),
  };
}

function getIdFromFormData(data: FormData, key: string) {
  return String(data.get(key) ?? "");
}

function isUniqueViolation(error: { code?: string; message?: string } | null) {
  return (
    error?.code === "23505" ||
    /duplicate key|unique constraint/i.test(error?.message ?? "")
  );
}

function revalidateUserGroupPaths(userGroupId?: string) {
  revalidatePath("/admin");
  revalidatePath("/admin/user-groups");
  revalidatePath("/me/groups");

  if (userGroupId) {
    revalidatePath(`/admin/user-groups/${userGroupId}`);
  }
}

async function revalidateContestGroupPaths(groupIds: string[]) {
  const uniqueGroupIds = [...new Set(groupIds)];
  if (uniqueGroupIds.length === 0) {
    return;
  }

  const supabase = await createServerDataClient();
  const { data: contests } = await supabase
    .from("contests")
    .select("id,group_id")
    .in("group_id", uniqueGroupIds);

  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath("/admin/groups");

  for (const groupId of uniqueGroupIds) {
    revalidatePath(`/admin/groups/${groupId}`);
    revalidatePath(`/admin/groups/${groupId}/edit`);
    revalidatePath(`/groups/${groupId}`);
    revalidatePath(`/groups/${groupId}/vote`);
  }

  for (const contest of contests ?? []) {
    revalidatePath(`/contests/${contest.id}`);
    revalidatePath(`/contests/${contest.id}/vote`);
    revalidatePath(`/contests/${contest.id}/results`);
  }
}

export async function createUserGroup(
  data: FormData | UserGroupInput,
): Promise<ActionResult<{ redirectTo?: string }>> {
  const adminResult = await getActionAdmin();
  if (!adminResult.ok) {
    return actionFailure(adminResult.error);
  }

  const parsed = userGroupSchema.safeParse(normalizeUserGroupInput(data));
  if (!parsed.success) {
    return actionFailure(parsed.error.issues[0]?.message ?? "用户组信息无效。");
  }

  const supabase = await createServerDataClient();
  const { data: userGroup, error } = await supabase
    .from("user_groups")
    .insert({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      join_code: parsed.data.join_code ?? null,
    })
    .select("id")
    .single();

  if (error || !userGroup) {
    return actionFailure(
      isUniqueViolation(error) ? "入组代码已被使用。" : "创建用户组失败。",
    );
  }

  revalidateUserGroupPaths(userGroup.id);
  return actionSuccess("用户组已创建", {
    redirectTo: `/admin/user-groups/${userGroup.id}`,
  });
}

export async function updateUserGroup(
  idOrData: string | FormData,
  data?: UserGroupInput,
): Promise<ActionResult> {
  const adminResult = await getActionAdmin();
  if (!adminResult.ok) {
    return actionFailure(adminResult.error);
  }

  const userGroupId =
    idOrData instanceof FormData ? getIdFromFormData(idOrData, "userGroupId") : idOrData;
  const idParsed = userGroupIdSchema.safeParse({ userGroupId });

  if (!idParsed.success) {
    return actionFailure("用户组无效。");
  }

  const parsed = userGroupSchema.safeParse(
    idOrData instanceof FormData ? normalizeUserGroupInput(idOrData) : data,
  );

  if (!parsed.success) {
    return actionFailure(parsed.error.issues[0]?.message ?? "用户组信息无效。");
  }

  const supabase = await createServerDataClient();
  const { error } = await supabase
    .from("user_groups")
    .update({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      join_code: parsed.data.join_code ?? null,
    })
    .eq("id", idParsed.data.userGroupId);

  if (error) {
    return actionFailure(
      isUniqueViolation(error) ? "入组代码已被使用。" : "保存用户组失败。",
    );
  }

  revalidateUserGroupPaths(idParsed.data.userGroupId);
  return actionSuccess("用户组已保存");
}

export async function deleteUserGroup(
  idOrData: string | FormData,
): Promise<ActionResult<{ redirectTo?: string }>> {
  const adminResult = await getActionAdmin();
  if (!adminResult.ok) {
    return actionFailure(adminResult.error);
  }

  const userGroupId =
    idOrData instanceof FormData ? getIdFromFormData(idOrData, "userGroupId") : idOrData;
  const parsed = userGroupIdSchema.safeParse({ userGroupId });

  if (!parsed.success) {
    return actionFailure("用户组无效。");
  }

  const supabase = await createServerDataClient();
  const { data: affectedGroups } = await supabase
    .from("contest_group_allowed_user_groups")
    .select("contest_group_id")
    .eq("user_group_id", parsed.data.userGroupId);

  const { error } = await supabase
    .from("user_groups")
    .delete()
    .eq("id", parsed.data.userGroupId);

  if (error) {
    return actionFailure(error.message || "删除用户组失败。");
  }

  revalidateUserGroupPaths(parsed.data.userGroupId);
  await revalidateContestGroupPaths(
    (affectedGroups ?? []).map((row) => row.contest_group_id),
  );
  return actionSuccess("用户组已删除", { redirectTo: "/admin/user-groups" });
}

export async function revokeUserGroupMember(
  idOrData: string | FormData,
): Promise<ActionResult> {
  const adminResult = await getActionAdmin();
  if (!adminResult.ok) {
    return actionFailure(adminResult.error);
  }

  const memberId =
    idOrData instanceof FormData ? getIdFromFormData(idOrData, "memberId") : idOrData;
  const parsed = memberIdSchema.safeParse({ memberId });

  if (!parsed.success) {
    return actionFailure("成员关系无效。");
  }

  const supabase = await createServerDataClient();
  const { data: member } = await supabase
    .from("user_group_members")
    .select("user_group_id,profile_id")
    .eq("id", parsed.data.memberId)
    .maybeSingle();
  const { error } = await supabase
    .from("user_group_members")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", parsed.data.memberId);

  if (error) {
    return actionFailure(error.message || "撤销成员权限失败。");
  }

  revalidateUserGroupPaths(member?.user_group_id);
  return actionSuccess("成员权限已撤销");
}

export async function renewUserGroupMember(
  idOrData: string | FormData,
): Promise<ActionResult> {
  const adminResult = await getActionAdmin();
  if (!adminResult.ok) {
    return actionFailure(adminResult.error);
  }

  const memberId =
    idOrData instanceof FormData ? getIdFromFormData(idOrData, "memberId") : idOrData;
  const parsed = memberIdSchema.safeParse({ memberId });

  if (!parsed.success) {
    return actionFailure("成员关系无效。");
  }

  const now = new Date();
  const supabase = await createServerDataClient();
  const { data: member } = await supabase
    .from("user_group_members")
    .select("user_group_id,profile_id")
    .eq("id", parsed.data.memberId)
    .maybeSingle();
  const { error } = await supabase
    .from("user_group_members")
    .update({
      source: "manual",
      revoked_at: null,
      last_verified_at: now.toISOString(),
      expires_at: getUserGroupMembershipExpiresAt(now).toISOString(),
    })
    .eq("id", parsed.data.memberId);

  if (error) {
    return actionFailure(error.message || "续期成员权限失败。");
  }

  revalidateUserGroupPaths(member?.user_group_id);
  return actionSuccess("成员权限已续期");
}

function normalizeContestGroupAccessInput(
  groupIdOrData: string | FormData,
  data?: ContestGroupAccessInput,
) {
  if (groupIdOrData instanceof FormData) {
    return {
      groupId: groupIdOrData.get("groupId"),
      accessMode: groupIdOrData.get("accessMode"),
      allowedUserGroupIds: [
        ...new Set(
          groupIdOrData
            .getAll("allowedUserGroupIds")
            .map((value) => String(value)),
        ),
      ],
    };
  }

  return {
    groupId: groupIdOrData,
    accessMode: data?.accessMode,
    allowedUserGroupIds: Array.isArray(data?.allowedUserGroupIds)
      ? [...new Set(data.allowedUserGroupIds.map((value) => String(value)))]
      : [],
  };
}

export async function updateContestGroupAccess(
  groupIdOrData: string | FormData,
  data?: ContestGroupAccessInput,
): Promise<ActionResult> {
  const adminResult = await getActionAdmin();
  if (!adminResult.ok) {
    return actionFailure(adminResult.error);
  }

  const parsed = contestGroupAccessSchema.safeParse(
    normalizeContestGroupAccessInput(groupIdOrData, data),
  );

  if (!parsed.success) {
    return actionFailure("参与权限设置无效。");
  }

  const accessMode = parsed.data.accessMode as ContestGroupAccessMode;
  const supabase = await createServerDataClient();
  const { error } = await supabase.rpc("update_contest_group_access_atomic", {
    p_group_id: parsed.data.groupId,
    p_access_mode: accessMode,
    p_allowed_user_group_ids: parsed.data.allowedUserGroupIds,
  });

  if (error) {
    return actionFailure(error.message || "保存参与权限失败。");
  }

  await revalidateContestGroupPaths([parsed.data.groupId]);
  return actionSuccess("参与权限已保存");
}
