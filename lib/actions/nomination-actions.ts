"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActionUser } from "@/lib/auth";
import { getDescriptionLimitError } from "@/lib/description-limit";
import { nominationDraftImagePath } from "@/lib/nomination-drafts";
import { canParticipateContestGroup } from "@/lib/permissions/user-groups";
import { createServerDataClient } from "@/lib/supabase/server-data";
import { createRequiredServiceClient } from "@/lib/supabase/service";
import type { Nomination, Profile } from "@/lib/types";

const nominationSchema = z.object({
  contestId: z.string().uuid(),
  nominationId: z.string().uuid().optional(),
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

type ImageMeta = z.infer<typeof imageMetaSchema>;

function nominationImagePathPattern(nominationId: string) {
  return new RegExp(`^nominations/${nominationId}/image\\.jpe?g$`);
}

async function removeStorageObjects(paths: string[]) {
  if (paths.length === 0) {
    return;
  }

  try {
    const supabase = createRequiredServiceClient();
    const { error } = await supabase.storage.from("vote-images").remove(paths);

    if (error) {
      console.warn("Failed to remove nomination image object:", error.message);
    }
  } catch (error) {
    console.warn(
      "Failed to initialize storage cleanup:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function prepareNominationImage(
  nominationId: string,
  userId: string,
  imageMeta: ImageMeta,
): Promise<
  | {
      ok: true;
      imageMeta: ImageMeta;
      temporaryPath: string;
      finalPath: string;
    }
  | { ok: false; error: string }
> {
  const temporaryPath = imageMeta.imagePath;
  const finalPath = `nominations/${nominationId}/image.jpg`;

  if (temporaryPath !== nominationDraftImagePath(userId, nominationId) &&
      temporaryPath !== `nomination-drafts/${nominationId}/image.jpg`) {
    return { ok: false, error: "请先上传提名图片后再提交。" };
  }

  try {
    const supabase = createRequiredServiceClient();
    const storage = supabase.storage.from("vote-images");

    const { data: file, error: downloadError } = await storage.download(temporaryPath);
    if (downloadError || !file) {
      return { ok: false, error: "提名图片未上传成功，请重新上传图片后再提交。" };
    }
    // Replacing this fixed destination also allows a retry after an interrupted copy.
    const { error } = await storage.upload(finalPath, file, {
      upsert: true,
      contentType: "image/jpeg",
      cacheControl: "3600",
    });

    if (error) {
      return {
        ok: false,
        error: "提名图片未上传成功，请重新上传图片后再提交。",
      };
    }

    return {
      ok: true,
      imageMeta: {
        ...imageMeta,
        imagePath: finalPath,
      },
      temporaryPath,
      finalPath,
    };
  } catch {
    return {
      ok: false,
      error: "图片上传服务暂不可用，请稍后再试。",
    };
  }
}

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
    .select("group_id,archived_at")
    .eq("id", contestId)
    .maybeSingle();

  if (!contest || contest.archived_at) {
    return "活动不存在或暂时无法读取，请稍后再试。";
  }

  return getGroupNominationAccessError(contest.group_id, profile);
}

export async function createNominationAction(formData: FormData): Promise<
  | { ok: false; error: string }
  | {
      ok: true;
      nominationId: string;
      nominationStatus: Nomination["status"];
      name: string;
      description: string | null;
      imagePath: string | null;
      message: string;
    }
> {
  const userResult = await getActionUser();
  if (!userResult.ok) {
    return { ok: false, error: userResult.error };
  }
  const user = userResult.profile;
  const parsed = nominationSchema.safeParse({
    contestId: formData.get("contestId"),
    nominationId: formData.get("nominationId") || undefined,
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
      "id,status,group_id,max_nominations_per_user,candidate_description_max_length,nomination_image_required,archived_at",
    )
    .eq("id", parsed.data.contestId)
    .maybeSingle();

  if (!contest || contest.archived_at) {
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

  async function completeCreation(nomination: Nomination) {
    if (nomination.status === "draft") {
      return { ok: false as const, error: "这条提名尚未完成，请在我的提名中继续编辑。" };
    }
    if (nomination.status === "approved") {
      const { data: candidate, error: lookupError } = await supabase
        .from("candidates").select("id").eq("nomination_id", nomination.id).maybeSingle();
      if (lookupError) return { ok: false as const, error: lookupError.message };
      if (!candidate) {
        const { error: candidateError } = await supabase.from("candidates").insert({
          contest_id: nomination.contest_id,
          nomination_id: nomination.id,
          name: nomination.name,
          description: nomination.description,
          nominator_display_name: nomination.nominator_display_name,
          image_path: nomination.image_path,
          image_width: nomination.image_width,
          image_height: nomination.image_height,
          image_size: nomination.image_size,
        });
        if (candidateError && candidateError.code !== "23505") {
          return { ok: false as const, error: candidateError.message };
        }
      }
    }
    revalidatePath(`/contests/${nomination.contest_id}`);
    revalidatePath(`/contests/${nomination.contest_id}/nominate`);
    revalidatePath(`/contests/${nomination.contest_id}/vote`);
    revalidatePath(`/contests/${nomination.contest_id}/results`);
    revalidatePath(`/contests/${nomination.contest_id}/my-nominations`);
    revalidatePath("/me/nominations");
    revalidatePath("/admin");
    return {
      ok: true as const,
      nominationId: nomination.id,
      nominationStatus: nomination.status,
      name: nomination.name,
      description: nomination.description,
      imagePath: nomination.image_path,
      message: "提名已提交",
    };
  }

  // A draft ID is also the idempotency key. Replays must not consume another slot.
  if (parsed.data.nominationId) {
    const { data: existing, error: lookupError } = await supabase
      .from("nominations").select("*").eq("id", parsed.data.nominationId).maybeSingle();
    if (lookupError) return { ok: false, error: "暂时无法确认提名状态，请稍后重试。" };
    if (existing) {
      if (existing.submitter_id !== user.id || existing.contest_id !== contest.id) {
        return { ok: false, error: "提名标识无效，请重新添加这条提名。" };
      }
      return completeCreation(existing);
    }
  }

  if (!isAdmin && contest.max_nominations_per_user !== null) {
    const { count, error: countError } = await supabase
      .from("nominations")
      .select("id", { count: "exact", head: true })
      .eq("contest_id", parsed.data.contestId)
      .eq("submitter_id", user.id)
      .neq("status", "rejected");

    if (countError) {
      return { ok: false, error: "暂时无法读取剩余提名名额，请稍后重试。" };
    }
    if ((count ?? 0) >= contest.max_nominations_per_user) {
      return { ok: false, error: "你在该活动中的提名数量已达上限。" };
    }
  }

  const requiresImage = contest.nomination_image_required === true;
  const hasImage = Boolean(formData.get("imagePath"));
  let attachedImage:
    | { imageMeta: ImageMeta; temporaryPath: string; finalPath: string }
    | null = null;

  if (requiresImage || hasImage) {
    if (!parsed.data.nominationId) {
      return { ok: false, error: "请先上传提名图片后再提交。" };
    }

    const imageMetaParsed = imageMetaSchema.safeParse({
      imagePath: formData.get("imagePath"),
      imageWidth: Number(formData.get("imageWidth")),
      imageHeight: Number(formData.get("imageHeight")),
      imageSize: Number(formData.get("imageSize")),
    });

    if (!imageMetaParsed.success) {
      return { ok: false, error: "请先上传提名图片后再提交。" };
    }

    const preparedImage = await prepareNominationImage(
      parsed.data.nominationId,
      user.id,
      imageMetaParsed.data,
    );

    if (!preparedImage.ok) {
      return preparedImage;
    }

    attachedImage = preparedImage;
  }

  const nominationStatus = isAdminNomination ? "approved" : "pending";
  const { data: nomination, error } = await supabase
    .from("nominations")
    .insert({
      ...(parsed.data.nominationId
        ? { id: parsed.data.nominationId }
        : {}),
      contest_id: parsed.data.contestId,
      submitter_id: user.id,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      nominator_display_name: parsed.data.nominator_display_name ?? null,
      status: nominationStatus,
      ...(attachedImage
        ? {
            image_path: attachedImage.imageMeta.imagePath,
            image_width: attachedImage.imageMeta.imageWidth,
            image_height: attachedImage.imageMeta.imageHeight,
            image_size: attachedImage.imageMeta.imageSize,
          }
        : {}),
    })
    .select("*")
    .single();

  if (error || !nomination) {
    // A concurrent retry or a lost response may have already created the row.
    const { data: existing, error: lookupError } = parsed.data.nominationId
      ? await supabase.from("nominations").select("*").eq("id", parsed.data.nominationId).maybeSingle()
      : { data: null, error: null };
    if (existing?.submitter_id === user.id && existing.contest_id === contest.id) {
      return completeCreation(existing);
    }
    if (attachedImage && !existing && !lookupError) {
      await removeStorageObjects([attachedImage.finalPath]);
    }

    return { ok: false, error: error?.message ?? "提交提名失败，请稍后再试。" };
  }

  const result = await completeCreation(nomination);
  if (!result.ok) return result;
  if (attachedImage) {
    await removeStorageObjects([attachedImage.temporaryPath]);
  }

  return result;
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

  const expectedPath = nominationImagePathPattern(nominationIdParsed.data);
  if (!expectedPath.test(imageMetaParsed.data.imagePath)) {
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
    .select("id,group_id,status,nomination_image_required,archived_at")
    .eq("id", nomination.contest_id)
    .maybeSingle();

  if (!contest || contest.archived_at) {
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
  revalidatePath(`/contests/${nomination.contest_id}/my-nominations`);
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

  const expectedPath = nominationImagePathPattern(nominationIdParsed.data);
  if (!expectedPath.test(imageMetaParsed.data.imagePath)) {
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
  revalidatePath(`/contests/${nomination.contest_id}/my-nominations`);
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
    .select("group_id,candidate_description_max_length,nomination_image_required,archived_at")
    .eq("id", nomination.contest_id)
    .maybeSingle();

  if (!contest || contest.archived_at) {
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
  revalidatePath(`/contests/${nomination.contest_id}/my-nominations`);
  revalidatePath("/admin");
  return {
    ok: true,
    message:
      nextStatus === "draft"
        ? "已保存，请上传图片后提交审核"
        : "已保存并重新提交",
  };
}
