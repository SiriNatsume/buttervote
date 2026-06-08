"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActionUser } from "@/lib/auth";
import { getDescriptionLimitError } from "@/lib/description-limit";
import { canParticipateContestGroup } from "@/lib/permissions/user-groups";
import { createServerDataClient } from "@/lib/supabase/server-data";
import type { Profile } from "@/lib/types";

const nominationSchema = z.object({
  contestId: z.string().uuid(),
  name: z.string().trim().min(1, "提名名称不能为空").max(120),
  description: z.string().trim().optional(),
  nominator_display_name: z.string().trim().max(120).optional(),
});

const imageMetaSchema = z.object({
  imagePath: z.string().min(1).max(500),
  imageWidth: z.number().int().positive(),
  imageHeight: z.number().int().positive(),
  imageSize: z.number().int().positive().max(2 * 1024 * 1024),
});

async function getGroupNominationAccessError(
  groupId: string | null | undefined,
  profile: Profile,
) {
  if (!groupId) {
    return null;
  }

  const canParticipate = await canParticipateContestGroup({
    contestGroupId: groupId,
    profile,
  });

  return canParticipate ? null : "你暂时没有参与该活动组提名的权限。";
}

async function getContestNominationAccessError(
  contestId: string,
  profile: Profile,
) {
  const supabase = await createServerDataClient();
  const { data: contest } = await supabase
    .from("contests")
    .select("group_id")
    .eq("id", contestId)
    .maybeSingle();

  if (!contest) {
    return "活动不存在或暂时无法读取，请稍后再试。";
  }

  return getGroupNominationAccessError(contest.group_id, profile);
}

export async function createNominationAction(formData: FormData) {
  const userResult = await getActionUser();
  if (!userResult.ok) {
    return { ok: false, error: userResult.error };
  }
  const user = userResult.profile;
  const parsed = nominationSchema.safeParse({
    contestId: formData.get("contestId"),
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    nominator_display_name: formData.get("nominator_display_name") || undefined,
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "提名信息无效，请检查后重试。",
    };
  }

  const supabase = await createServerDataClient();
  const { data: contest } = await supabase
    .from("contests")
    .select(
      "id,status,group_id,max_nominations_per_user,candidate_description_max_length,nomination_image_required",
    )
    .eq("id", parsed.data.contestId)
    .maybeSingle();

  if (!contest) {
    return { ok: false, error: "活动不存在或暂时无法读取，请稍后再试。" };
  }

  const descriptionLimitError = getDescriptionLimitError(
    parsed.data.description,
    contest.candidate_description_max_length,
  );

  if (descriptionLimitError) {
    return { ok: false, error: descriptionLimitError };
  }

  const isAdmin = user.role === "admin";
  const isPublicNomination = contest.status === "nominating";
  const isAdminNomination = contest.status === "admin_nominating" && isAdmin;

  if (!isPublicNomination && !isAdminNomination) {
    return { ok: false, error: "当前活动不在可提名阶段。" };
  }

  const accessError = await getGroupNominationAccessError(contest.group_id, user);
  if (accessError) {
    return { ok: false, error: accessError };
  }

  if (!isAdmin && contest.max_nominations_per_user !== null) {
    const { count } = await supabase
      .from("nominations")
      .select("id", { count: "exact", head: true })
      .eq("contest_id", parsed.data.contestId)
      .eq("submitter_id", user.id)
      .neq("status", "rejected");

    if ((count ?? 0) >= contest.max_nominations_per_user) {
      return { ok: false, error: "你在该活动中的提名数量已达上限。" };
    }
  }

  const requiresImage = contest.nomination_image_required === true;
  const nominationStatus = requiresImage
    ? "draft"
    : isAdminNomination
      ? "approved"
      : "pending";
  const { data: nomination, error } = await supabase
    .from("nominations")
    .insert({
      contest_id: parsed.data.contestId,
      submitter_id: user.id,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      nominator_display_name: parsed.data.nominator_display_name ?? null,
      status: nominationStatus,
    })
    .select("id")
    .single();

  if (error || !nomination) {
    return { ok: false, error: error?.message ?? "提交提名失败，请稍后再试。" };
  }

  if (nominationStatus === "approved") {
    const { error: candidateError } = await supabase.from("candidates").insert({
      contest_id: parsed.data.contestId,
      nomination_id: nomination.id,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      nominator_display_name: parsed.data.nominator_display_name ?? null,
    });

    if (candidateError) {
      return { ok: false, error: candidateError.message };
    }
  }

  revalidatePath(`/contests/${parsed.data.contestId}`);
  revalidatePath(`/contests/${parsed.data.contestId}/vote`);
  revalidatePath(`/contests/${parsed.data.contestId}/results`);
  revalidatePath("/me/nominations");
  revalidatePath("/admin");
  return {
    ok: true,
    message: requiresImage
      ? "提名信息已保存，请上传图片后提交审核"
      : "提名已提交",
    redirectTo: `/contests/${parsed.data.contestId}/nominate?nominationId=${nomination.id}`,
  };
}

export async function updateNominationImageAction(
  nominationId: string,
  imageMeta: unknown,
) {
  const userResult = await getActionUser();
  if (!userResult.ok) {
    return { ok: false, error: userResult.error };
  }
  const user = userResult.profile;
  const nominationIdParsed = z.string().uuid().safeParse(nominationId);
  const imageMetaParsed = imageMetaSchema.safeParse(imageMeta);

  if (!nominationIdParsed.success || !imageMetaParsed.success) {
    return { ok: false, error: "图片信息无效。" };
  }

  const expectedPath = `nominations/${nominationIdParsed.data}/image.webp`;
  if (imageMetaParsed.data.imagePath !== expectedPath) {
    return { ok: false, error: "图片路径与提名不匹配。" };
  }

  const supabase = await createServerDataClient();
  const { data: nomination, error: nominationError } = await supabase
    .from("nominations")
    .select(
      "id,contest_id,submitter_id,name,description,status,nominator_display_name,nominator_note",
    )
    .eq("id", nominationIdParsed.data)
    .maybeSingle();

  if (nominationError || !nomination) {
    return { ok: false, error: "提名不存在或不可读取。" };
  }

  const isOwner = nomination.submitter_id === user.id;
  const isAdmin = user.role === "admin";

  if (!isOwner && !isAdmin) {
    return { ok: false, error: "你不能修改这个提名。" };
  }

  if (
    isOwner &&
    !isAdmin &&
    !["draft", "pending", "rejected"].includes(nomination.status)
  ) {
    return { ok: false, error: "已通过审核的提名不能由用户修改图片。" };
  }

  const { data: contest } = await supabase
    .from("contests")
    .select("id,group_id,status,nomination_image_required")
    .eq("id", nomination.contest_id)
    .maybeSingle();

  if (!contest) {
    return { ok: false, error: "活动不存在或暂时无法读取，请稍后再试。" };
  }

  const accessError = await getGroupNominationAccessError(contest.group_id, user);
  if (accessError) {
    return { ok: false, error: accessError };
  }

  const shouldSubmitDraft =
    nomination.status === "draft" && contest.nomination_image_required === true;
  const statusUpdate = shouldSubmitDraft
    ? {
        status: "pending" as const,
        rejection_reason: null,
        rejected_at: null,
      }
    : {};
  const imageUpdate = {
    image_path: imageMetaParsed.data.imagePath,
    image_width: imageMetaParsed.data.imageWidth,
    image_height: imageMetaParsed.data.imageHeight,
    image_size: imageMetaParsed.data.imageSize,
  };

  const { error } = await supabase
    .from("nominations")
    .update({
      ...imageUpdate,
      ...statusUpdate,
    })
    .eq("id", nomination.id);

  if (error) {
    return { ok: false, error: error.message };
  }

  if (nomination.status === "approved" && isAdmin) {
    const { error: candidateError } = await supabase
      .from("candidates")
      .update(imageUpdate)
      .eq("nomination_id", nomination.id);

    if (candidateError) {
      return { ok: false, error: candidateError.message };
    }
  }

  revalidatePath("/admin");
  revalidatePath("/me/nominations");
  revalidatePath(`/contests/${nomination.contest_id}`);
  revalidatePath(`/contests/${nomination.contest_id}/nominate`);
  revalidatePath(`/contests/${nomination.contest_id}/vote`);
  revalidatePath(`/contests/${nomination.contest_id}/results`);
  return { ok: true };
}

export async function updateApprovedNominationImage(
  nominationId: string,
  imageMeta: unknown,
) {
  const userResult = await getActionUser();
  if (!userResult.ok) {
    return { ok: false, error: userResult.error };
  }
  const user = userResult.profile;
  const nominationIdParsed = z.string().uuid().safeParse(nominationId);
  const imageMetaParsed = imageMetaSchema.safeParse(imageMeta);

  if (!nominationIdParsed.success || !imageMetaParsed.success) {
    return { ok: false, error: "图片信息无效。" };
  }

  const expectedPath = `nominations/${nominationIdParsed.data}/image.webp`;
  if (imageMetaParsed.data.imagePath !== expectedPath) {
    return { ok: false, error: "图片路径与提名不匹配。" };
  }

  const supabase = await createServerDataClient();
  const { data: nomination, error: nominationError } = await supabase
    .from("nominations")
    .select("id,contest_id,submitter_id,status,image_path")
    .eq("id", nominationIdParsed.data)
    .maybeSingle();

  if (nominationError || !nomination) {
    return { ok: false, error: "提名不存在或不可读取。" };
  }

  if (nomination.submitter_id !== user.id) {
    return { ok: false, error: "你不能修改这条提名。" };
  }

  if (nomination.status !== "approved") {
    return { ok: false, error: "只有已通过的提名可以补充图片。" };
  }

  if (nomination.image_path) {
    return { ok: false, error: "该提名已经有图片，不能重复补充。" };
  }

  const accessError = await getContestNominationAccessError(
    nomination.contest_id,
    user,
  );
  if (accessError) {
    return { ok: false, error: accessError };
  }

  const { data: candidate, error: candidateLookupError } = await supabase
    .from("candidates")
    .select("id")
    .eq("nomination_id", nomination.id)
    .maybeSingle();

  if (candidateLookupError) {
    return { ok: false, error: candidateLookupError.message };
  }

  if (!candidate) {
    return { ok: false, error: "未找到对应选项，无法补充图片。" };
  }

  const imageUpdate = {
    image_path: imageMetaParsed.data.imagePath,
    image_width: imageMetaParsed.data.imageWidth,
    image_height: imageMetaParsed.data.imageHeight,
    image_size: imageMetaParsed.data.imageSize,
  };

  const { error } = await supabase
    .from("nominations")
    .update(imageUpdate)
    .eq("id", nomination.id)
    .is("image_path", null)
    .eq("submitter_id", user.id)
    .eq("status", "approved");

  if (error) {
    return { ok: false, error: error.message };
  }

  const { error: candidateError } = await supabase
    .from("candidates")
    .update(imageUpdate)
    .eq("id", candidate.id);

  if (candidateError) {
    return { ok: false, error: candidateError.message };
  }

  revalidatePath("/me/nominations");
  revalidatePath(`/contests/${nomination.contest_id}`);
  revalidatePath(`/contests/${nomination.contest_id}/vote`);
  revalidatePath(`/contests/${nomination.contest_id}/results`);
  return { ok: true };
}

export async function updateMyNomination(formData: FormData) {
  const userResult = await getActionUser();
  if (!userResult.ok) {
    return { ok: false, error: userResult.error };
  }
  const user = userResult.profile;
  const parsed = z
    .object({
      nominationId: z.string().uuid(),
      name: z.string().trim().min(1, "提名名称不能为空").max(120),
      description: z.string().trim().optional(),
      nominator_display_name: z.string().trim().max(120).optional(),
    })
    .safeParse({
      nominationId: formData.get("nominationId"),
      name: formData.get("name"),
      description: formData.get("description") || undefined,
      nominator_display_name: formData.get("nominator_display_name") || undefined,
    });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "提名信息无效。",
    };
  }

  const supabase = await createServerDataClient();
  const { data: nomination, error: nominationError } = await supabase
    .from("nominations")
    .select("id,contest_id,submitter_id,status,image_path")
    .eq("id", parsed.data.nominationId)
    .maybeSingle();

  if (nominationError || !nomination || nomination.submitter_id !== user.id) {
    return {
      ok: false,
      error: nominationError?.message ?? "提名不存在或不属于你。",
    };
  }

  if (!["draft", "pending", "rejected"].includes(nomination.status)) {
    return { ok: false, error: "已通过审核的提名不能再修改。" };
  }

  const { data: contest } = await supabase
    .from("contests")
    .select("group_id,candidate_description_max_length,nomination_image_required")
    .eq("id", nomination.contest_id)
    .maybeSingle();

  if (!contest) {
    return { ok: false, error: "活动不存在或暂时无法读取，请稍后再试。" };
  }

  const accessError = await getGroupNominationAccessError(contest.group_id, user);
  if (accessError) {
    return { ok: false, error: accessError };
  }

  const descriptionLimitError = getDescriptionLimitError(
    parsed.data.description,
    contest.candidate_description_max_length,
  );

  if (descriptionLimitError) {
    return { ok: false, error: descriptionLimitError };
  }

  const nextStatus =
    contest.nomination_image_required === true && !nomination.image_path
      ? "draft"
      : "pending";
  const { error } = await supabase
    .from("nominations")
    .update({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      nominator_display_name: parsed.data.nominator_display_name ?? null,
      status: nextStatus,
      rejection_reason: null,
      rejected_at: null,
    })
    .eq("id", nomination.id)
    .eq("submitter_id", user.id)
    .in("status", ["draft", "pending", "rejected"]);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/me/nominations");
  revalidatePath(`/contests/${nomination.contest_id}`);
  revalidatePath(`/contests/${nomination.contest_id}/nominate`);
  revalidatePath("/admin");
  return {
    ok: true,
    message:
      nextStatus === "draft"
        ? "已保存，请上传图片后提交审核"
        : "已保存并重新提交",
  };
}
