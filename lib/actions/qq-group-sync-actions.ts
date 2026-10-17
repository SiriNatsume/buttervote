"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActionAdmin } from "@/lib/auth";
import { createRequiredServiceClient } from "@/lib/supabase/service";
import { qqNumberSchema } from "@/lib/validation/qq-auth";
import { removeQQGroupRosterSchema } from "@/lib/validation/qq-group-roster";

export async function requestQQGroupSync(formData: FormData) {
  const admin = await getActionAdmin();
  if (!admin.ok) return { ok: false, error: admin.error };
  const parsed = z.object({ userGroupId: z.string().uuid(), qqGroupId: qqNumberSchema }).safeParse({
    userGroupId: formData.get("userGroupId"), qqGroupId: formData.get("qqGroupId"),
  });
  if (!parsed.success) return { ok: false, error: "请输入有效的 QQ 群号。" };
  const { error } = await createRequiredServiceClient().rpc("request_qq_group_sync", {
    p_user_group_id: parsed.data.userGroupId, p_qq_group_id: parsed.data.qqGroupId, p_admin_id: admin.profile.id,
  });
  if (error) return { ok: false, error: error.message.includes("QQ_GROUP_ALREADY_BOUND")
    ? "此用户组已绑定其他 QQ 群，请为新 QQ 群创建独立用户组。"
    : error.code === "23505" ? "该 QQ 群已绑定其他用户组。" : "提交同步任务失败，请稍后重试。" };
  revalidatePath(`/admin/user-groups/${parsed.data.userGroupId}`);
  return { ok: true, message: "同步任务已提交，等待 Bot 获取群成员。" };
}

export async function removeQQGroupRosterMembers(formData: FormData) {
  const admin = await getActionAdmin();
  if (!admin.ok) return { ok: false, error: admin.error };
  const parsed = removeQQGroupRosterSchema.safeParse({
    userGroupId: formData.get("userGroupId"), mode: formData.get("mode"),
    qqUserIds: formData.getAll("qqUserId"),
  });
  if (!parsed.success) return { ok: false, error: "请选择有效的匹配条目，或使用移除全部操作。" };
  const { data, error } = await createRequiredServiceClient().rpc("remove_qq_group_roster_members", {
    p_user_group_id: parsed.data.userGroupId, p_admin_id: admin.profile.id,
    p_qq_user_ids: parsed.data.qqUserIds, p_remove_all: parsed.data.mode === "all",
  });
  if (error) return { ok: false, error: "移除匹配列表失败，请刷新后重试。" };
  revalidatePath(`/admin/user-groups/${parsed.data.userGroupId}`);
  revalidatePath("/admin/user-groups");
  revalidatePath("/me/groups");
  revalidatePath("/");
  return { ok: true, message: `已移除 ${data ?? 0} 个匹配条目，对应名单资格已撤销。` };
}
