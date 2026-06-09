"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActionAdmin, requireAdmin } from "@/lib/auth";
import { toUserFacingError } from "@/lib/action-error";
import {
  closedResultVisibilities,
  contestStatuses,
  scheduledTransitionTargets,
} from "@/lib/contest-rules";
import { getDescriptionLimitError } from "@/lib/description-limit";
import { createServerDataClient } from "@/lib/supabase/server-data";
import { createRequiredServiceClient } from "@/lib/supabase/service";
import type {
  ContestStatus,
  HomepageBracketValue,
  HomepageHeroValue,
  Json,
  ScheduledTransitionTarget,
} from "@/lib/types";

const contestSchema = z.object({
  title: z.string().trim().min(1, "标题不能为空").max(160),
  description: z.string().trim().max(2000).optional(),
  status: z.enum(contestStatuses),
  vote_type: z.enum(["single", "multiple", "ranked"]),
  max_choices: z.coerce.number().int().min(1),
  require_exact_choices: z.boolean(),
  nomination_image_required: z.boolean(),
  group_id: z.string().uuid().nullable(),
  show_candidate_image: z.boolean(),
  show_candidate_description: z.boolean(),
});

const updateContestSchema = contestSchema.extend({
  contestId: z.string().uuid(),
});

const statusSchema = z.object({
  contestId: z.string().uuid(),
  status: z.enum(contestStatuses),
});

const reviewSchema = z.object({
  nominationId: z.string().uuid(),
  reviewAction: z.enum(["approve", "reject"]),
  rejectionReason: z.string().trim().max(500, "拒绝理由最多 500 字").optional(),
});

const batchReviewSchema = z.object({
  nominationIds: z.array(z.string().uuid()).min(1, "请至少选择一条提名"),
  action: z.enum(["approve", "reject"]),
  rejectionReason: z.string().trim().max(500, "拒绝理由最多 500 字").optional(),
});

const groupSchema = z.object({
  name: z.string().trim().min(1, "活动组名称不能为空").max(160),
  description: z.string().trim().max(2000).optional(),
  love_vote_weight: z.coerce.number().positive(),
  love_vote_quota: z.coerce.number().int().min(0),
});

const updateGroupSchema = groupSchema.extend({
  groupId: z.string().uuid(),
});

const groupIdSchema = z.object({
  groupId: z.string().uuid(),
});

const imageMetaSchema = z.object({
  imagePath: z.string().min(1).max(500),
  imageWidth: z.number().int().positive(),
  imageHeight: z.number().int().positive(),
  imageSize: z.number().int().positive().max(2 * 1024 * 1024),
});

const inheritSchema = z.object({
  targetContestId: z.string().uuid(),
  sourceContestId: z.string().uuid(),
  candidateIds: z.array(z.string().uuid()).min(1, "请至少选择一个候选项"),
});

const homepageHeroSchema = z.object({
  featuredType: z.enum(["group", "contest", "tournament"]),
  featuredId: z.string().uuid(),
  title: z.string().trim().max(160).optional(),
  description: z.string().trim().max(1000).optional(),
});

const homepageBracketSchema = z.object({
  tournamentId: z.union([z.string().uuid(), z.literal("none")]),
});

const candidateSchema = z.object({
  contestId: z.string().uuid(),
  name: z.string().trim().min(1, "候选项名称不能为空").max(160),
  description: z.string().trim().optional(),
  nominator_display_name: z.string().trim().max(120).optional(),
});

const updateCandidateSchema = candidateSchema.extend({
  candidateId: z.string().uuid(),
});

const candidateIdSchema = z.object({
  candidateId: z.string().uuid(),
});

const contestSettingsSchema = z.object({
  contestId: z.string().uuid(),
  show_candidate_image: z.boolean(),
  show_candidate_description: z.boolean(),
  show_nominator_info: z.boolean(),
  show_existing_nominations: z.boolean(),
  max_nominations_per_user: z.number().int().min(0).nullable(),
  candidate_description_max_length: z.number().int().positive().nullable(),
  live_results_enabled: z.boolean(),
  closed_result_visibility: z.enum(closedResultVisibilities),
  love_vote_enabled: z.boolean(),
  voting_starts_at: z.string().nullable(),
  voting_ends_at: z.string().nullable(),
});

const scheduledTransitionSchema = z.object({
  contestId: z.string().uuid(),
  target_status: z.enum(scheduledTransitionTargets),
  run_at: z.string().datetime(),
});

const scheduledTransitionIdSchema = z.object({
  transitionId: z.string().uuid(),
});

const batchGroupScheduleSchema = z.object({
  groupId: z.string().uuid(),
  contestIds: z.array(z.string().uuid()).min(1, "请至少选择一个活动"),
  status: z.enum(contestStatuses).optional(),
  votingStartAt: z.string().nullable().optional(),
  votingEndAt: z.string().nullable().optional(),
});

function optionalUuidFromForm(value: FormDataEntryValue | null) {
  const text = String(value ?? "");
  return text && text !== "none" ? text : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkboxFromForm(value: FormDataEntryValue | null) {
  return value === "on" || value === "true";
}

function optionalTrimmedText(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text ? text : undefined;
}

function optionalIntegerFromForm(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }

  const numeric = Number(text);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
}

function optionalPositiveIntegerFromForm(value: FormDataEntryValue | null) {
  const numeric = optionalIntegerFromForm(value);
  return numeric && numeric > 0 ? numeric : null;
}

function datetimeLocalToIso(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }

  const normalized =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text) ||
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(text)
      ? `${text.length === 16 ? `${text}:00` : text}+08:00`
      : text;
  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function normalizeOptionalDateTime(value: string | null | undefined) {
  if (value === undefined) {
    return { provided: false as const };
  }

  if (value === null || value.trim() === "") {
    return { provided: true as const, value: null };
  }

  const isoValue = datetimeLocalToIso(value);
  if (!isoValue) {
    return {
      provided: true as const,
      error: "时间无效，请检查日期和时间。",
    };
  }

  return { provided: true as const, value: isoValue };
}

function revalidateContest(contestId: string) {
  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath(`/admin/contests/${contestId}/edit`);
  revalidatePath(`/contests/${contestId}`);
  revalidatePath(`/contests/${contestId}/vote`);
  revalidatePath(`/contests/${contestId}/results`);
}

function revalidateGroup(groupId: string) {
  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath("/admin/groups");
  revalidatePath(`/admin/groups/${groupId}`);
  revalidatePath(`/admin/groups/${groupId}/edit`);
  revalidatePath(`/groups/${groupId}`);
  revalidatePath(`/groups/${groupId}/vote`);
}

type ServerDataClient = Awaited<ReturnType<typeof createServerDataClient>>;

type ActionResult<T extends Record<string, unknown> = Record<string, unknown>> =
  | ({ ok: true; message?: string } & T)
  | { ok: false; error: string };

function actionSuccess<T extends Record<string, unknown> = Record<string, unknown>>(
  message?: string,
  extra?: T,
): ActionResult<T> {
  return { ok: true, ...(message ? { message } : {}), ...(extra ?? ({} as T)) };
}

function actionFailure(message: string): ActionResult {
  return { ok: false, error: toUserFacingError(message) };
}

function friendlyReviewWriteError(error?: { code?: string; message?: string } | null) {
  const message = error?.message ?? "";

  if (
    error?.code === "23505" ||
    /duplicate key|unique constraint/i.test(message)
  ) {
    return "该提名已经生成过候选项，请刷新后再试。";
  }

  return message || "审核写入失败，请稍后重试。";
}

async function getNextClosedTransitionRunAt(
  supabase: ServerDataClient,
  contestId: string,
) {
  const { data } = await supabase
    .from("contest_scheduled_transitions")
    .select("run_at")
    .eq("contest_id", contestId)
    .eq("target_status", "closed")
    .is("executed_at", null)
    .gt("run_at", new Date().toISOString())
    .order("run_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return data?.run_at ?? null;
}

async function getNextVotingTransitionRunAt(
  supabase: ServerDataClient,
  contestId: string,
) {
  const { data } = await supabase
    .from("contest_scheduled_transitions")
    .select("run_at")
    .eq("contest_id", contestId)
    .eq("target_status", "voting")
    .is("executed_at", null)
    .gt("run_at", new Date().toISOString())
    .order("run_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return data?.run_at ?? null;
}

async function syncVotingStartsAtFromVotingTransitions(
  supabase: ServerDataClient,
  contestId: string,
) {
  const nextRunAt = await getNextVotingTransitionRunAt(supabase, contestId);
  await supabase
    .from("contests")
    .update({ voting_starts_at: nextRunAt })
    .eq("id", contestId);

  return nextRunAt;
}

async function syncVotingEndsAtFromClosedTransitions(
  supabase: ServerDataClient,
  contestId: string,
) {
  const nextRunAt = await getNextClosedTransitionRunAt(supabase, contestId);
  await supabase
    .from("contests")
    .update({ voting_ends_at: nextRunAt })
    .eq("id", contestId);

  return nextRunAt;
}

async function syncPendingScheduledTransition({
  supabase,
  contestId,
  targetStatus,
  runAt,
  createdBy,
}: {
  supabase: ServerDataClient;
  contestId: string;
  targetStatus: ScheduledTransitionTarget;
  runAt: string | null;
  createdBy: string;
}): Promise<ActionResult> {
  const { data: existingTransitions, error: lookupError } = await supabase
    .from("contest_scheduled_transitions")
    .select("id")
    .eq("contest_id", contestId)
    .eq("target_status", targetStatus)
    .is("executed_at", null)
    .order("created_at", { ascending: true });

  if (lookupError) {
    return actionFailure(lookupError.message);
  }

  if (!runAt) {
    const { error } = await supabase
      .from("contest_scheduled_transitions")
      .delete()
      .eq("contest_id", contestId)
      .eq("target_status", targetStatus)
      .is("executed_at", null);

    return error ? actionFailure(error.message) : actionSuccess();
  }

  const [primaryTransition, ...duplicateTransitions] = existingTransitions ?? [];

  if (primaryTransition) {
    const duplicateIds = duplicateTransitions.map((transition) => transition.id);
    if (duplicateIds.length > 0) {
      const { error: deleteError } = await supabase
        .from("contest_scheduled_transitions")
        .delete()
        .in("id", duplicateIds)
        .is("executed_at", null);

      if (deleteError) {
        return actionFailure(deleteError.message);
      }
    }

    const { error } = await supabase
      .from("contest_scheduled_transitions")
      .update({ run_at: runAt })
      .eq("id", primaryTransition.id)
      .is("executed_at", null);

    if (error) {
      return actionFailure(error.message);
    }

    return actionSuccess();
  }

  const { count, error: countError } = await supabase
    .from("contest_scheduled_transitions")
    .select("id", { count: "exact", head: true })
    .eq("contest_id", contestId)
    .is("executed_at", null);

  if (countError) {
    return actionFailure(countError.message);
  }

  if ((count ?? 0) >= 2) {
    return actionFailure("每个活动最多配置两个未执行的定时状态。");
  }

  const { error } = await supabase.from("contest_scheduled_transitions").insert({
    contest_id: contestId,
    target_status: targetStatus,
    run_at: runAt,
    created_by: createdBy,
  });

  return error ? actionFailure(error.message) : actionSuccess();
}

async function getContestDescriptionMaxLength(
  supabase: ServerDataClient,
  contestId: string,
) {
  const { data } = await supabase
    .from("contests")
    .select("candidate_description_max_length")
    .eq("id", contestId)
    .maybeSingle();

  return data?.candidate_description_max_length ?? null;
}

async function ensureDescriptionWithinContestLimit(
  supabase: ServerDataClient,
  contestId: string,
  description: string | undefined,
  onError: (message: string) => never,
) {
  const maxLength = await getContestDescriptionMaxLength(supabase, contestId);
  const error = getDescriptionLimitError(description, maxLength);

  if (error) {
    onError(error);
  }
}

async function getGroupValidationError(groupId: string | null) {
  if (!groupId) {
    return null;
  }

  const supabase = await createServerDataClient();
  const { data, error } = await supabase
    .from("contest_groups")
    .select("id")
    .eq("id", groupId)
    .maybeSingle();

  if (error) {
    return error.message;
  }

  return data ? null : "选择的活动组不存在。";
}

export async function createContestAction(formData: FormData) {
  const adminResult = await getActionAdmin();
  if (!adminResult.ok) {
    return actionFailure(adminResult.error);
  }
  const admin = adminResult.profile;
  const parsed = contestSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    status: formData.get("status"),
    vote_type: formData.get("vote_type"),
    max_choices: formData.get("max_choices"),
    require_exact_choices: checkboxFromForm(formData.get("require_exact_choices")),
    nomination_image_required: checkboxFromForm(
      formData.get("nomination_image_required"),
    ),
    group_id: optionalUuidFromForm(formData.get("group_id")),
    show_candidate_image: checkboxFromForm(formData.get("show_candidate_image")),
    show_candidate_description: checkboxFromForm(
      formData.get("show_candidate_description"),
    ),
  });

  if (!parsed.success) {
    return actionFailure(parsed.error.issues[0]?.message ?? "活动信息无效。");
  }

  const groupValidationError = await getGroupValidationError(parsed.data.group_id);
  if (groupValidationError) {
    return actionFailure(groupValidationError);
  }

  const supabase = await createServerDataClient();
  const { data, error } = await supabase
    .from("contests")
    .insert({
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      status: parsed.data.status,
      vote_type: parsed.data.vote_type,
      max_choices: parsed.data.max_choices,
      require_exact_choices: parsed.data.require_exact_choices,
      nomination_image_required: parsed.data.nomination_image_required,
      group_id: parsed.data.group_id,
      show_candidate_image: parsed.data.show_candidate_image,
      show_candidate_description: parsed.data.show_candidate_description,
      created_by: admin.id,
    })
    .select("id,group_id")
    .single();

  if (error || !data) {
    return actionFailure(error?.message ?? "创建活动失败。");
  }

  revalidatePath("/");
  revalidatePath("/admin");
  if (data.group_id) {
    revalidateGroup(data.group_id);
  }
  return actionSuccess("活动已创建", {
    redirectTo: `/admin/contests/${data.id}/edit`,
  });
}

export async function updateContestAction(formData: FormData) {
  const adminResult = await getActionAdmin();
  if (!adminResult.ok) {
    return actionFailure(adminResult.error);
  }
  const parsed = updateContestSchema.safeParse({
    contestId: formData.get("contestId"),
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    status: formData.get("status"),
    vote_type: formData.get("vote_type"),
    max_choices: formData.get("max_choices"),
    require_exact_choices: checkboxFromForm(formData.get("require_exact_choices")),
    nomination_image_required: checkboxFromForm(
      formData.get("nomination_image_required"),
    ),
    group_id: optionalUuidFromForm(formData.get("group_id")),
    show_candidate_image: checkboxFromForm(formData.get("show_candidate_image")),
    show_candidate_description: checkboxFromForm(
      formData.get("show_candidate_description"),
    ),
  });

  if (!parsed.success) {
    return actionFailure(parsed.error.issues[0]?.message ?? "活动信息无效。");
  }

  const groupValidationError = await getGroupValidationError(parsed.data.group_id);
  if (groupValidationError) {
    return actionFailure(groupValidationError);
  }

  const { contestId, ...updates } = parsed.data;
  const supabase = await createServerDataClient();
  const votingEndsAt =
    updates.status === "voting"
      ? await getNextClosedTransitionRunAt(supabase, contestId)
      : undefined;
  const { data: previous } = await supabase
    .from("contests")
    .select("group_id,archived_at")
    .eq("id", contestId)
    .maybeSingle();

  if (!previous || previous.archived_at) {
    return actionFailure("活动不存在或已归档。");
  }

  const { error } = await supabase
    .from("contests")
    .update({
      title: updates.title,
      description: updates.description ?? null,
      status: updates.status,
      vote_type: updates.vote_type,
      max_choices: updates.max_choices,
      require_exact_choices: updates.require_exact_choices,
      nomination_image_required: updates.nomination_image_required,
      group_id: updates.group_id,
      show_candidate_image: updates.show_candidate_image,
      show_candidate_description: updates.show_candidate_description,
      ...(votingEndsAt !== undefined ? { voting_ends_at: votingEndsAt } : {}),
    })
    .eq("id", contestId)
    .is("archived_at", null);

  if (error) {
    return actionFailure(error.message);
  }

  revalidateContest(contestId);
  if (previous?.group_id) {
    revalidateGroup(previous.group_id);
  }
  if (updates.group_id) {
    revalidateGroup(updates.group_id);
  }
  return actionSuccess("保存成功");
}

export async function updateContestStatusAction(
  contestId: string,
  status: ContestStatus,
) {
  const adminResult = await getActionAdmin();
  if (!adminResult.ok) {
    return actionFailure(adminResult.error);
  }
  const parsed = statusSchema.safeParse({ contestId, status });

  if (!parsed.success) {
    return actionFailure("活动状态无效。");
  }

  const supabase = await createServerDataClient();
  const votingEndsAt =
    parsed.data.status === "voting"
      ? await getNextClosedTransitionRunAt(supabase, parsed.data.contestId)
      : undefined;
  const { data, error } = await supabase
    .from("contests")
    .update({
      status: parsed.data.status,
      ...(votingEndsAt !== undefined ? { voting_ends_at: votingEndsAt } : {}),
    })
    .eq("id", parsed.data.contestId)
    .is("archived_at", null)
    .select("group_id")
    .maybeSingle();

  if (error) {
    return actionFailure(error.message);
  }

  if (!data) {
    return actionFailure("活动不存在或已归档。");
  }

  revalidateContest(parsed.data.contestId);
  if (data?.group_id) {
    revalidateGroup(data.group_id);
  }
  return actionSuccess("状态已更新");
}

export async function archiveContestAction(formData: FormData) {
  const adminResult = await getActionAdmin();
  if (!adminResult.ok) {
    return actionFailure(adminResult.error);
  }

  const parsed = z
    .object({ contestId: z.string().uuid() })
    .safeParse({ contestId: formData.get("contestId") });

  if (!parsed.success) {
    return actionFailure("活动无效。");
  }

  const supabase = createRequiredServiceClient();
  const { data, error } = await supabase.rpc("archive_contest_atomic", {
    p_contest_id: parsed.data.contestId,
    p_archived_by: adminResult.profile.id,
  });

  if (error) {
    return actionFailure(error.message || "归档活动失败。");
  }

  const groupId =
    isRecord(data) && typeof data.groupId === "string" ? data.groupId : null;

  revalidateContest(parsed.data.contestId);
  revalidatePath("/admin/tournaments");
  if (groupId) {
    revalidateGroup(groupId);
  }

  return actionSuccess("活动已归档");
}

export async function updateContestImageAction(
  contestId: string,
  imageMeta: unknown,
) {
  const adminResult = await getActionAdmin();
  if (!adminResult.ok) {
    return actionFailure(adminResult.error);
  }
  const contestIdParsed = z.string().uuid().safeParse(contestId);
  const imageMetaParsed = imageMetaSchema.safeParse(imageMeta);

  if (!contestIdParsed.success || !imageMetaParsed.success) {
    return { ok: false, error: "图片信息无效。" };
  }

  const expectedPath = `contests/${contestIdParsed.data}/cover.webp`;
  if (imageMetaParsed.data.imagePath !== expectedPath) {
    return { ok: false, error: "图片路径与活动不匹配。" };
  }

  const supabase = await createServerDataClient();
  const { data, error } = await supabase
    .from("contests")
    .update({
      image_path: imageMetaParsed.data.imagePath,
      image_width: imageMetaParsed.data.imageWidth,
      image_height: imageMetaParsed.data.imageHeight,
      image_size: imageMetaParsed.data.imageSize,
    })
    .eq("id", contestIdParsed.data)
    .is("archived_at", null)
    .select("group_id")
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidateContest(contestIdParsed.data);
  if (data?.group_id) {
    revalidateGroup(data.group_id);
  }
  return { ok: true };
}

export async function updateContestSettings(formData: FormData) {
  const adminResult = await getActionAdmin();
  if (!adminResult.ok) {
    return actionFailure(adminResult.error);
  }
  const admin = adminResult.profile;
  const contestId = String(formData.get("contestId") ?? "");
  const parsed = contestSettingsSchema.safeParse({
    contestId,
    show_candidate_image: checkboxFromForm(formData.get("show_candidate_image")),
    show_candidate_description: checkboxFromForm(
      formData.get("show_candidate_description"),
    ),
    show_nominator_info: checkboxFromForm(formData.get("show_nominator_info")),
    show_existing_nominations: checkboxFromForm(
      formData.get("show_existing_nominations"),
    ),
    max_nominations_per_user: optionalIntegerFromForm(
      formData.get("max_nominations_per_user"),
    ),
    candidate_description_max_length: optionalPositiveIntegerFromForm(
      formData.get("candidate_description_max_length"),
    ),
    live_results_enabled: checkboxFromForm(formData.get("live_results_enabled")),
    closed_result_visibility: formData.get("closed_result_visibility"),
    love_vote_enabled: checkboxFromForm(formData.get("love_vote_enabled")),
    voting_starts_at: datetimeLocalToIso(formData.get("voting_starts_at")),
    voting_ends_at: datetimeLocalToIso(formData.get("voting_ends_at")),
  });

  if (!parsed.success) {
    return actionFailure(parsed.error.issues[0]?.message ?? "活动设置无效。");
  }

  const supabase = await createServerDataClient();
  const { data: activeContest } = await supabase
    .from("contests")
    .select("id")
    .eq("id", parsed.data.contestId)
    .is("archived_at", null)
    .maybeSingle();

  if (!activeContest) {
    return actionFailure("活动不存在或已归档。");
  }

  const votingStartSync = await syncPendingScheduledTransition({
    supabase,
    contestId: parsed.data.contestId,
    targetStatus: "voting",
    runAt: parsed.data.voting_starts_at,
    createdBy: admin.id,
  });

  if (!votingStartSync.ok) {
    return votingStartSync;
  }

  const votingEndSync = await syncPendingScheduledTransition({
    supabase,
    contestId: parsed.data.contestId,
    targetStatus: "closed",
    runAt: parsed.data.voting_ends_at,
    createdBy: admin.id,
  });

  if (!votingEndSync.ok) {
    return votingEndSync;
  }

  const { data, error } = await supabase
    .from("contests")
    .update({
      show_candidate_image: parsed.data.show_candidate_image,
      show_candidate_description: parsed.data.show_candidate_description,
      show_nominator_info: parsed.data.show_nominator_info,
      show_existing_nominations: parsed.data.show_existing_nominations,
      max_nominations_per_user: parsed.data.max_nominations_per_user,
      candidate_description_max_length:
        parsed.data.candidate_description_max_length,
      live_results_enabled: parsed.data.live_results_enabled,
      closed_result_visibility: parsed.data.closed_result_visibility,
      love_vote_enabled: parsed.data.love_vote_enabled,
      voting_starts_at: parsed.data.voting_starts_at,
      voting_ends_at: parsed.data.voting_ends_at,
    })
    .eq("id", parsed.data.contestId)
    .is("archived_at", null)
    .select("group_id")
    .maybeSingle();

  if (error) {
    return actionFailure(error.message);
  }

  revalidateContest(parsed.data.contestId);
  if (data?.group_id) {
    revalidateGroup(data.group_id);
  }
  return actionSuccess("运营设置已保存");
}

export async function createCandidateByAdmin(formData: FormData) {
  const adminResult = await getActionAdmin();
  if (!adminResult.ok) {
    return actionFailure(adminResult.error);
  }
  const parsed = candidateSchema.safeParse({
    contestId: formData.get("contestId"),
    name: formData.get("name"),
    description: optionalTrimmedText(formData.get("description")),
    nominator_display_name: optionalTrimmedText(
      formData.get("nominator_display_name"),
    ),
  });

  if (!parsed.success) {
    return actionFailure(parsed.error.issues[0]?.message ?? "候选项信息无效。");
  }

  const supabase = await createServerDataClient();
  const maxLength = await getContestDescriptionMaxLength(
    supabase,
    parsed.data.contestId,
  );
  const descriptionLimitError = getDescriptionLimitError(
    parsed.data.description,
    maxLength,
  );
  if (descriptionLimitError) {
    return actionFailure(descriptionLimitError);
  }

  const { error } = await supabase.from("candidates").insert({
    contest_id: parsed.data.contestId,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    nominator_display_name: parsed.data.nominator_display_name ?? null,
    is_active: true,
  });

  if (error) {
    return actionFailure(error.message);
  }

  revalidateContest(parsed.data.contestId);
  return actionSuccess("候选项已添加");
}

export async function updateCandidateByAdmin(formData: FormData) {
  const adminResult = await getActionAdmin();
  if (!adminResult.ok) {
    return actionFailure(adminResult.error);
  }
  const parsed = updateCandidateSchema.safeParse({
    contestId: formData.get("contestId"),
    candidateId: formData.get("candidateId"),
    name: formData.get("name"),
    description: optionalTrimmedText(formData.get("description")),
    nominator_display_name: optionalTrimmedText(
      formData.get("nominator_display_name"),
    ),
  });

  if (!parsed.success) {
    return actionFailure(parsed.error.issues[0]?.message ?? "候选项信息无效。");
  }

  const supabase = await createServerDataClient();
  const maxLength = await getContestDescriptionMaxLength(
    supabase,
    parsed.data.contestId,
  );
  const descriptionLimitError = getDescriptionLimitError(
    parsed.data.description,
    maxLength,
  );
  if (descriptionLimitError) {
    return actionFailure(descriptionLimitError);
  }

  const { error } = await supabase
    .from("candidates")
    .update({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      nominator_display_name: parsed.data.nominator_display_name ?? null,
    })
    .eq("id", parsed.data.candidateId)
    .eq("contest_id", parsed.data.contestId);

  if (error) {
    return actionFailure(error.message);
  }

  revalidateContest(parsed.data.contestId);
  return actionSuccess("候选项已保存");
}

export async function updateCandidateImageByAdmin(
  candidateId: string,
  imageMeta: unknown,
) {
  const adminResult = await getActionAdmin();
  if (!adminResult.ok) {
    return actionFailure(adminResult.error);
  }
  const candidateIdParsed = z.string().uuid().safeParse(candidateId);
  const imageMetaParsed = imageMetaSchema.safeParse(imageMeta);

  if (!candidateIdParsed.success || !imageMetaParsed.success) {
    return { ok: false, error: "图片信息无效。" };
  }

  const expectedPath = `candidates/${candidateIdParsed.data}/image.webp`;
  if (imageMetaParsed.data.imagePath !== expectedPath) {
    return { ok: false, error: "图片路径与候选项不匹配。" };
  }

  const supabase = await createServerDataClient();
  const { data, error } = await supabase
    .from("candidates")
    .update({
      image_path: imageMetaParsed.data.imagePath,
      image_width: imageMetaParsed.data.imageWidth,
      image_height: imageMetaParsed.data.imageHeight,
      image_size: imageMetaParsed.data.imageSize,
    })
    .eq("id", candidateIdParsed.data)
    .select("contest_id")
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message };
  }

  if (data?.contest_id) {
    revalidateContest(data.contest_id);
  }
  return { ok: true };
}

export async function softDeleteCandidateByAdmin(formData: FormData) {
  const adminResult = await getActionAdmin();
  if (!adminResult.ok) {
    return actionFailure(adminResult.error);
  }
  const parsed = candidateIdSchema.safeParse({
    candidateId: formData.get("candidateId"),
  });

  if (!parsed.success) {
    return actionFailure("候选项无效。");
  }

  const supabase = await createServerDataClient();
  const { data, error } = await supabase
    .from("candidates")
    .update({ is_active: false, deleted_at: new Date().toISOString() })
    .eq("id", parsed.data.candidateId)
    .select("contest_id")
    .maybeSingle();

  if (error || !data) {
    return actionFailure(error?.message ?? "删除失败。");
  }

  revalidateContest(data.contest_id);
  return actionSuccess("候选项已删除");
}

export async function restoreCandidateByAdmin(formData: FormData) {
  const adminResult = await getActionAdmin();
  if (!adminResult.ok) {
    return actionFailure(adminResult.error);
  }
  const parsed = candidateIdSchema.safeParse({
    candidateId: formData.get("candidateId"),
  });

  if (!parsed.success) {
    return actionFailure("候选项无效。");
  }

  const supabase = await createServerDataClient();
  const { data, error } = await supabase
    .from("candidates")
    .update({ is_active: true, deleted_at: null })
    .eq("id", parsed.data.candidateId)
    .select("contest_id")
    .maybeSingle();

  if (error || !data) {
    return actionFailure(error?.message ?? "恢复失败。");
  }

  revalidateContest(data.contest_id);
  return actionSuccess("候选项已恢复");
}

export async function createScheduledTransition(formData: FormData) {
  const adminResult = await getActionAdmin();
  if (!adminResult.ok) {
    return actionFailure(adminResult.error);
  }
  const admin = adminResult.profile;
  const contestId = String(formData.get("contestId") ?? "");
  const runAt = datetimeLocalToIso(formData.get("run_at"));
  const parsed = scheduledTransitionSchema.safeParse({
    contestId,
    target_status: formData.get("target_status"),
    run_at: runAt,
  });

  if (!parsed.success) {
    return actionFailure(parsed.error.issues[0]?.message ?? "定时状态配置无效。");
  }

  const supabase = await createServerDataClient();
  const { data: contest } = await supabase
    .from("contests")
    .select("id")
    .eq("id", parsed.data.contestId)
    .is("archived_at", null)
    .maybeSingle();

  if (!contest) {
    return actionFailure("活动不存在或已归档。");
  }

  const syncResult = await syncPendingScheduledTransition({
    supabase,
    contestId: parsed.data.contestId,
    targetStatus: parsed.data.target_status as ScheduledTransitionTarget,
    runAt: parsed.data.run_at,
    createdBy: admin.id,
  });

  if (!syncResult.ok) {
    return syncResult;
  }

  if (parsed.data.target_status === "voting") {
    await syncVotingStartsAtFromVotingTransitions(supabase, parsed.data.contestId);
  }

  if (parsed.data.target_status === "closed") {
    await syncVotingEndsAtFromClosedTransitions(supabase, parsed.data.contestId);
  }

  revalidateContest(parsed.data.contestId);
  return actionSuccess("定时状态已更新");
}

export async function deleteScheduledTransition(formData: FormData) {
  const adminResult = await getActionAdmin();
  if (!adminResult.ok) {
    return actionFailure(adminResult.error);
  }
  const parsed = scheduledTransitionIdSchema.safeParse({
    transitionId: formData.get("transitionId"),
  });

  if (!parsed.success) {
    return actionFailure("定时状态无效。");
  }

  const supabase = await createServerDataClient();
  const { data: transition, error: lookupError } = await supabase
    .from("contest_scheduled_transitions")
    .select("id,contest_id,target_status,run_at,executed_at")
    .eq("id", parsed.data.transitionId)
    .maybeSingle();

  if (lookupError || !transition) {
    return actionFailure(lookupError?.message ?? "定时状态不存在。");
  }

  if (transition.executed_at) {
    return actionFailure("已执行的定时状态不能删除。");
  }

  const { error } = await supabase
    .from("contest_scheduled_transitions")
    .delete()
    .eq("id", transition.id)
    .is("executed_at", null);

  if (error) {
    return actionFailure(error.message);
  }

  if (transition.target_status === "voting") {
    await syncVotingStartsAtFromVotingTransitions(supabase, transition.contest_id);
  }

  if (transition.target_status === "closed") {
    await syncVotingEndsAtFromClosedTransitions(supabase, transition.contest_id);
  }

  revalidateContest(transition.contest_id);
  return actionSuccess("定时状态已删除");
}

export async function batchUpdateGroupContestSchedule(input: unknown) {
  const adminResult = await getActionAdmin();
  if (!adminResult.ok) {
    return actionFailure(adminResult.error);
  }
  const admin = adminResult.profile;
  const parsed = batchGroupScheduleSchema.safeParse(input);

  if (!parsed.success) {
    return actionFailure(
      parsed.error.issues[0]?.message ?? "批量设置请求无效。",
    );
  }

  const contestIds = [...new Set(parsed.data.contestIds)];
  if (contestIds.length === 0) {
    return actionFailure("请至少选择一个活动。");
  }

  const startAt = normalizeOptionalDateTime(parsed.data.votingStartAt);
  const endAt = normalizeOptionalDateTime(parsed.data.votingEndAt);

  if ("error" in startAt) {
    return actionFailure(`投票开始时间${startAt.error}`);
  }

  if ("error" in endAt) {
    return actionFailure(`投票结束时间${endAt.error}`);
  }

  if (
    startAt.provided &&
    endAt.provided &&
    startAt.value &&
    endAt.value &&
    new Date(endAt.value).getTime() <= new Date(startAt.value).getTime()
  ) {
    return actionFailure("投票结束时间必须晚于投票开始时间。");
  }

  if (!parsed.data.status && !startAt.provided && !endAt.provided) {
    return actionFailure("请至少选择一个要批量更新的项目。");
  }

  const supabase = await createServerDataClient();
  const { data: contests, error: contestsError } = await supabase
    .from("contests")
    .select("id,group_id")
    .is("archived_at", null)
    .in("id", contestIds);

  if (contestsError) {
    return actionFailure(contestsError.message);
  }

  if ((contests ?? []).length !== contestIds.length) {
    return actionFailure("部分活动不存在，无法批量设置。");
  }

  if ((contests ?? []).some((contest) => contest.group_id !== parsed.data.groupId)) {
    return actionFailure("所选活动必须全部属于当前活动组。");
  }

  const contestUpdate: Record<string, unknown> = {};
  if (parsed.data.status) {
    contestUpdate.status = parsed.data.status;
  }
  if (startAt.provided) {
    contestUpdate.voting_starts_at = startAt.value;
  }
  if (endAt.provided) {
    contestUpdate.voting_ends_at = endAt.value;
  }

  if (Object.keys(contestUpdate).length > 0) {
    const { error } = await supabase
      .from("contests")
      .update(contestUpdate)
      .is("archived_at", null)
      .in("id", contestIds);

    if (error) {
      return actionFailure(error.message);
    }
  }

  for (const contestId of contestIds) {
    if (startAt.provided) {
      const result = await syncPendingScheduledTransition({
        supabase,
        contestId,
        targetStatus: "voting",
        runAt: startAt.value,
        createdBy: admin.id,
      });

      if (!result.ok) {
        return result;
      }
    }

    if (endAt.provided) {
      const result = await syncPendingScheduledTransition({
        supabase,
        contestId,
        targetStatus: "closed",
        runAt: endAt.value,
        createdBy: admin.id,
      });

      if (!result.ok) {
        return result;
      }
    }
  }

  revalidatePath("/admin");
  revalidatePath("/admin/groups");
  revalidatePath(`/admin/groups/${parsed.data.groupId}`);
  revalidatePath(`/groups/${parsed.data.groupId}`);
  revalidatePath(`/groups/${parsed.data.groupId}/vote`);
  for (const contestId of contestIds) {
    revalidateContest(contestId);
  }

  return actionSuccess("批量设置已保存", { updatedCount: contestIds.length });
}

export async function reviewNominationAction(formData: FormData) {
  const adminResult = await getActionAdmin();
  if (!adminResult.ok) {
    return actionFailure(adminResult.error);
  }
  const parsed = reviewSchema.safeParse({
    nominationId: formData.get("nominationId"),
    reviewAction: formData.get("reviewAction"),
    rejectionReason: optionalTrimmedText(formData.get("rejectionReason")),
  });

  if (!parsed.success) {
    return actionFailure("审核请求无效。");
  }

  const supabase = await createServerDataClient();
  const { data: nomination, error: nominationError } = await supabase
    .from("nominations")
    .select("id,contest_id,submitter_id,name,description,status,image_path")
    .eq("id", parsed.data.nominationId)
    .maybeSingle();

  if (nominationError || !nomination) {
    return actionFailure(nominationError?.message ?? "提名不存在。");
  }

  if (nomination.status !== "pending") {
    return actionFailure("该提名已经处理过。");
  }

  if (parsed.data.reviewAction === "approve") {
    const { data: contestForReview } = await supabase
      .from("contests")
      .select("candidate_description_max_length,nomination_image_required,archived_at")
      .eq("id", nomination.contest_id)
      .maybeSingle();

    if (!contestForReview || contestForReview.archived_at) {
      return actionFailure("活动不存在或已归档。");
    }

    if (contestForReview?.nomination_image_required === true && !nomination.image_path) {
      return actionFailure("该活动要求提名图片，请先补充图片后再通过。");
    }

    const descriptionLimitError = getDescriptionLimitError(
      nomination.description ?? undefined,
      contestForReview?.candidate_description_max_length ?? null,
    );

    if (descriptionLimitError) {
      return actionFailure(descriptionLimitError);
    }

    const { error: reviewError } = await supabase.rpc(
      "review_nominations_atomic",
      {
        p_nomination_ids: [nomination.id],
        p_action: "approve",
      },
    );

    if (reviewError) {
      return actionFailure(friendlyReviewWriteError(reviewError));
    }

    await supabase
      .from("nominations")
      .update({ rejection_reason: null, rejected_at: null })
      .eq("id", nomination.id);
  } else {
    const { data: rejectedNomination, error: reviewError } = await supabase
      .from("nominations")
      .update({
        status: "rejected",
        rejection_reason: parsed.data.rejectionReason ?? null,
        rejected_at: new Date().toISOString(),
      })
      .eq("id", nomination.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (reviewError || !rejectedNomination) {
      return actionFailure(
        reviewError ? friendlyReviewWriteError(reviewError) : "该提名已经处理过。",
      );
    }
  }

  revalidatePath("/admin");
  revalidatePath("/me/nominations");
  revalidateContest(nomination.contest_id);
  return actionSuccess(
    parsed.data.reviewAction === "approve" ? "提名已通过" : "提名已拒绝",
  );
}

export async function batchReviewNominations(input: unknown) {
  const adminResult = await getActionAdmin();
  if (!adminResult.ok) {
    return actionFailure(adminResult.error);
  }
  const parsed = batchReviewSchema.safeParse(input);

  if (!parsed.success) {
    return actionFailure(parsed.error.issues[0]?.message ?? "批量审核请求无效。");
  }

  const nominationIds = [...new Set(parsed.data.nominationIds)];
  const supabase = await createServerDataClient();
  const { data: nominations, error: nominationError } = await supabase
    .from("nominations")
    .select("id,contest_id,name,description,status,image_path")
    .in("id", nominationIds);

  if (nominationError) {
    return actionFailure(nominationError.message);
  }

  if ((nominations ?? []).length !== nominationIds.length) {
    return actionFailure("部分提名不存在，无法批量审核。");
  }

  if ((nominations ?? []).some((nomination) => nomination.status !== "pending")) {
    return actionFailure("只能批量审核待审核提名。");
  }

  const contestIds = [
    ...new Set((nominations ?? []).map((nomination) => nomination.contest_id)),
  ];

  if (parsed.data.action === "approve") {
    const { data: contests, error: contestsError } = await supabase
      .from("contests")
      .select("id,candidate_description_max_length,nomination_image_required,archived_at")
      .in("id", contestIds);

    if (contestsError) {
      return actionFailure(contestsError.message);
    }

    if (
      (contests ?? []).length !== contestIds.length ||
      (contests ?? []).some((contest) => contest.archived_at)
    ) {
      return actionFailure("部分活动不存在或已归档，无法批量通过提名。");
    }

    const descriptionLimitByContest = new Map(
      (contests ?? []).map((contest) => [
        contest.id,
        contest.candidate_description_max_length,
      ]),
    );
    const imageRequiredByContest = new Map(
      (contests ?? []).map((contest) => [
        contest.id,
        contest.nomination_image_required === true,
      ]),
    );

    for (const nomination of nominations ?? []) {
      if (
        imageRequiredByContest.get(nomination.contest_id) === true &&
        !nomination.image_path
      ) {
        return actionFailure(
          `${nomination.name}：该活动要求提名图片，请先补充图片后再通过。`,
        );
      }

      const descriptionLimitError = getDescriptionLimitError(
        nomination.description ?? undefined,
        descriptionLimitByContest.get(nomination.contest_id) ?? null,
      );

      if (descriptionLimitError) {
        return actionFailure(`${nomination.name}：${descriptionLimitError}`);
      }
    }

    const { error: reviewError } = await supabase.rpc(
      "review_nominations_atomic",
      {
        p_nomination_ids: nominationIds,
        p_action: "approve",
      },
    );

    if (reviewError) {
      return actionFailure(friendlyReviewWriteError(reviewError));
    }

    await supabase
      .from("nominations")
      .update({ rejection_reason: null, rejected_at: null })
      .in("id", nominationIds);
  } else {
    const { data: rejectedNominations, error: reviewError } = await supabase
      .from("nominations")
      .update({
        status: "rejected",
        rejection_reason: parsed.data.rejectionReason ?? null,
        rejected_at: new Date().toISOString(),
      })
      .in("id", nominationIds)
      .eq("status", "pending")
      .select("id");

    if (reviewError) {
      return actionFailure(friendlyReviewWriteError(reviewError));
    }

    if ((rejectedNominations ?? []).length !== nominationIds.length) {
      return actionFailure("部分提名已经处理过，请刷新后再试。");
    }
  }

  revalidatePath("/admin");
  revalidatePath("/me/nominations");
  for (const contestId of contestIds) {
    revalidateContest(contestId);
  }

  return actionSuccess(
    parsed.data.action === "approve"
      ? `已通过 ${nominationIds.length} 条提名`
      : `已拒绝 ${nominationIds.length} 条提名`,
    { count: nominationIds.length },
  );
}

export async function createGroupAction(formData: FormData) {
  const adminResult = await getActionAdmin();
  if (!adminResult.ok) {
    return actionFailure(adminResult.error);
  }
  const admin = adminResult.profile;
  const parsed = groupSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    love_vote_weight: formData.get("love_vote_weight"),
    love_vote_quota: formData.get("love_vote_quota"),
  });

  if (!parsed.success) {
    return actionFailure(parsed.error.issues[0]?.message ?? "活动组信息无效。");
  }

  const supabase = await createServerDataClient();
  const { data, error } = await supabase
    .from("contest_groups")
    .insert({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      love_vote_weight: parsed.data.love_vote_weight,
      love_vote_quota: parsed.data.love_vote_quota,
      created_by: admin.id,
    })
    .select("id")
    .single();

  if (error || !data) {
    return actionFailure(error?.message ?? "创建活动组失败。");
  }

  revalidatePath("/");
  revalidatePath("/admin/groups");
  return actionSuccess("活动组已创建", {
    redirectTo: `/admin/groups/${data.id}/edit`,
  });
}

export async function updateGroupAction(formData: FormData) {
  const adminResult = await getActionAdmin();
  if (!adminResult.ok) {
    return actionFailure(adminResult.error);
  }
  const parsed = updateGroupSchema.safeParse({
    groupId: formData.get("groupId"),
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    love_vote_weight: formData.get("love_vote_weight"),
    love_vote_quota: formData.get("love_vote_quota"),
  });

  if (!parsed.success) {
    return actionFailure(parsed.error.issues[0]?.message ?? "活动组信息无效。");
  }

  const { groupId, ...updates } = parsed.data;
  const supabase = await createServerDataClient();
  const { error } = await supabase
    .from("contest_groups")
    .update({
      name: updates.name,
      description: updates.description ?? null,
      love_vote_weight: updates.love_vote_weight,
      love_vote_quota: updates.love_vote_quota,
    })
    .eq("id", groupId);

  if (error) {
    return actionFailure(error.message);
  }

  revalidateGroup(groupId);
  return actionSuccess("活动组设置已保存");
}

export async function deleteContestGroup(groupId: string) {
  const adminResult = await getActionAdmin();
  if (!adminResult.ok) {
    return actionFailure(adminResult.error);
  }
  const parsed = groupIdSchema.safeParse({ groupId });

  if (!parsed.success) {
    return actionFailure("活动组无效。");
  }

  const supabase = await createServerDataClient();
  const [{ data: group, error: groupQueryError }, { data: contests }] =
    await Promise.all([
      supabase
        .from("contest_groups")
        .select("id")
        .eq("id", parsed.data.groupId)
        .maybeSingle(),
      supabase
        .from("contests")
        .select("id")
        .eq("group_id", parsed.data.groupId),
    ]);

  if (groupQueryError) {
    return actionFailure(groupQueryError.message);
  }

  if (!group) {
    return actionFailure("活动组不存在或已被删除。");
  }

  const { error } = await supabase
    .from("contest_groups")
    .delete()
    .eq("id", parsed.data.groupId);

  if (error) {
    return actionFailure(error.message || "删除活动组失败。");
  }

  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath("/admin/groups");
  revalidatePath(`/admin/groups/${parsed.data.groupId}`);
  revalidatePath(`/admin/groups/${parsed.data.groupId}/edit`);
  revalidatePath(`/groups/${parsed.data.groupId}`);
  revalidatePath(`/groups/${parsed.data.groupId}/vote`);

  for (const contest of contests ?? []) {
    revalidateContest(contest.id);
  }

  return actionSuccess("活动组已删除", { redirectTo: "/admin/groups" });
}

export async function deleteContestGroupAction(formData: FormData) {
  return deleteContestGroup(String(formData.get("groupId") ?? ""));
}

export async function updateGroupImageAction(
  groupId: string,
  imageMeta: unknown,
) {
  const adminResult = await getActionAdmin();
  if (!adminResult.ok) {
    return actionFailure(adminResult.error);
  }
  const groupIdParsed = z.string().uuid().safeParse(groupId);
  const imageMetaParsed = imageMetaSchema.safeParse(imageMeta);

  if (!groupIdParsed.success || !imageMetaParsed.success) {
    return { ok: false, error: "图片信息无效。" };
  }

  const expectedPath = `groups/${groupIdParsed.data}/cover.webp`;
  if (imageMetaParsed.data.imagePath !== expectedPath) {
    return { ok: false, error: "图片路径与活动组不匹配。" };
  }

  const supabase = await createServerDataClient();
  const { error } = await supabase
    .from("contest_groups")
    .update({
      cover_image_path: imageMetaParsed.data.imagePath,
      cover_image_width: imageMetaParsed.data.imageWidth,
      cover_image_height: imageMetaParsed.data.imageHeight,
      cover_image_size: imageMetaParsed.data.imageSize,
    })
    .eq("id", groupIdParsed.data);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidateGroup(groupIdParsed.data);
  return { ok: true };
}

export async function inheritCandidatesAction(formData: FormData) {
  const adminResult = await getActionAdmin();
  if (!adminResult.ok) {
    return actionFailure(adminResult.error);
  }
  const parsed = inheritSchema.safeParse({
    targetContestId: formData.get("targetContestId"),
    sourceContestId: formData.get("sourceContestId"),
    candidateIds: formData.getAll("candidateIds").map(String),
  });

  if (!parsed.success) {
    return actionFailure(parsed.error.issues[0]?.message ?? "继承请求无效。");
  }

  if (parsed.data.targetContestId === parsed.data.sourceContestId) {
    return actionFailure("来源活动和目标活动不能相同。");
  }

  const supabase = await createServerDataClient();
  const { data: contests, error: contestsError } = await supabase
    .from("contests")
    .select("id,group_id,candidate_description_max_length")
    .is("archived_at", null)
    .in("id", [parsed.data.targetContestId, parsed.data.sourceContestId]);

  if (contestsError || !contests || contests.length !== 2) {
    return actionFailure(contestsError?.message ?? "活动查询失败。");
  }

  const targetContest = contests.find(
    (contest) => contest.id === parsed.data.targetContestId,
  );
  const sourceContest = contests.find(
    (contest) => contest.id === parsed.data.sourceContestId,
  );

  if (!targetContest?.group_id || targetContest.group_id !== sourceContest?.group_id) {
    return actionFailure("来源活动和目标活动必须属于同一个活动组。");
  }

  const requestedIds = [...new Set(parsed.data.candidateIds)];
  const { data: sourceCandidates, error: sourceError } = await supabase
    .from("candidates")
    .select(
      "id,name,description,image_path,image_width,image_height,image_size,nominator_display_name,nominator_note",
    )
    .eq("contest_id", parsed.data.sourceContestId)
    .eq("is_active", true)
    .in("id", requestedIds);

  if (sourceError || !sourceCandidates || sourceCandidates.length === 0) {
    return actionFailure(sourceError?.message ?? "未找到可继承的来源候选项。");
  }

  const { data: existingInherited } = await supabase
    .from("candidates")
    .select("inherited_from_candidate_id")
    .eq("contest_id", parsed.data.targetContestId)
    .in("inherited_from_candidate_id", sourceCandidates.map((item) => item.id));

  const existingIds = new Set(
    (existingInherited ?? [])
      .map((item) => item.inherited_from_candidate_id)
      .filter(Boolean),
  );
  const rows = sourceCandidates
    .filter((candidate) => !existingIds.has(candidate.id))
    .map((candidate) => ({
      source_candidate_id: candidate.id,
      contest_id: parsed.data.targetContestId,
      inherited_from_candidate_id: candidate.id,
      name: candidate.name,
      description: candidate.description,
      image_path: candidate.image_path,
      image_width: candidate.image_width,
      image_height: candidate.image_height,
      image_size: candidate.image_size,
      nominator_display_name: candidate.nominator_display_name,
      nominator_note: candidate.nominator_note,
    }));

  const oversizedCandidate = rows.find((candidate) =>
    getDescriptionLimitError(
      candidate.description ?? undefined,
      targetContest.candidate_description_max_length,
    ),
  );

  if (oversizedCandidate) {
    return actionFailure(
      getDescriptionLimitError(
        oversizedCandidate.description ?? undefined,
        targetContest.candidate_description_max_length,
      ) ?? "候选项简介超过字数限制。",
    );
  }

  const { data: inheritedCount, error: inheritError } = await supabase.rpc(
    "inherit_candidates_atomic",
    {
      p_target_contest_id: parsed.data.targetContestId,
      p_source_contest_id: parsed.data.sourceContestId,
      p_source_candidate_ids: rows.map((row) => row.source_candidate_id),
    },
  );

  if (inheritError) {
    return actionFailure(inheritError.message);
  }

  revalidateContest(parsed.data.targetContestId);
  revalidateGroup(targetContest.group_id);
  return actionSuccess(`已继承 ${inheritedCount ?? 0} 个候选项`, {
    refresh: true,
  });
}

export async function updateHomepageHeroAction(formData: FormData) {
  const adminResult = await getActionAdmin();
  if (!adminResult.ok) {
    return actionFailure(adminResult.error);
  }
  const parsed = homepageHeroSchema.safeParse({
    featuredType: formData.get("featuredType"),
    featuredId: formData.get("featuredId"),
    title: formData.get("title") || undefined,
    description: formData.get("description") || undefined,
  });

  if (!parsed.success) {
    return actionFailure(parsed.error.issues[0]?.message ?? "首页 Hero 配置无效。");
  }

  const supabase = await createServerDataClient();
  const { data: featured } =
    parsed.data.featuredType === "group"
      ? await supabase
          .from("contest_groups")
          .select("id")
          .eq("id", parsed.data.featuredId)
          .maybeSingle()
      : parsed.data.featuredType === "contest"
        ? await supabase
            .from("contests")
            .select("id")
            .eq("id", parsed.data.featuredId)
            .is("archived_at", null)
            .maybeSingle()
        : await supabase
            .from("tournaments")
            .select("id")
            .eq("id", parsed.data.featuredId)
            .neq("status", "archived")
            .maybeSingle();

  if (!featured) {
    return actionFailure("推荐对象不存在。");
  }

  const { data: existing } = await supabase
    .from("site_settings")
    .select("value")
    .eq("key", "homepage_hero")
    .maybeSingle();

  const existingValue = (existing?.value ?? {}) as HomepageHeroValue;
  const value: HomepageHeroValue = {
    featuredType: parsed.data.featuredType,
    featuredId: parsed.data.featuredId,
  };

  if (parsed.data.title) {
    value.title = parsed.data.title;
  }
  if (parsed.data.description) {
    value.description = parsed.data.description;
  }
  if (existingValue.imagePath) {
    value.imagePath = existingValue.imagePath;
  }

  const { error } = await supabase.from("site_settings").upsert({
    key: "homepage_hero",
    value: value as Json,
  });

  if (error) {
    return actionFailure(error.message);
  }

  revalidatePath("/");
  revalidatePath("/admin/homepage");
  return actionSuccess("首页 Hero 已保存");
}

export async function updateHomepageBracketAction(formData: FormData) {
  const adminResult = await getActionAdmin();
  if (!adminResult.ok) {
    return actionFailure(adminResult.error);
  }

  const parsed = homepageBracketSchema.safeParse({
    tournamentId: formData.get("tournamentId"),
  });

  if (!parsed.success) {
    return actionFailure("首页对阵图配置无效。");
  }

  const supabase = await createServerDataClient();
  const value: HomepageBracketValue =
    parsed.data.tournamentId === "none"
      ? { tournamentId: null }
      : { tournamentId: parsed.data.tournamentId };

  if (value.tournamentId) {
    const { data: tournament } = await supabase
      .from("tournaments")
      .select("id")
      .eq("id", value.tournamentId)
      .neq("status", "archived")
      .maybeSingle();

    if (!tournament) {
      return actionFailure("赛事不存在或已归档。");
    }
  }

  const { error } = await supabase.from("site_settings").upsert({
    key: "homepage_bracket",
    value: value as Json,
  });

  if (error) {
    return actionFailure(error.message);
  }

  revalidatePath("/");
  revalidatePath("/admin/homepage");
  return actionSuccess("首页对阵图已保存");
}

export async function updateHomepageHeroImageAction(imageMeta: unknown) {
  const adminResult = await getActionAdmin();
  if (!adminResult.ok) {
    return actionFailure(adminResult.error);
  }
  const imageMetaParsed = imageMetaSchema.safeParse(imageMeta);

  if (!imageMetaParsed.success) {
    return { ok: false, error: "图片信息无效。" };
  }

  if (imageMetaParsed.data.imagePath !== "homepage/hero.webp") {
    return { ok: false, error: "图片路径与首页 Hero 不匹配。" };
  }

  const supabase = await createServerDataClient();
  const { data: existing } = await supabase
    .from("site_settings")
    .select("value")
    .eq("key", "homepage_hero")
    .maybeSingle();

  const value = {
    ...((existing?.value ?? {}) as HomepageHeroValue),
    imagePath: imageMetaParsed.data.imagePath,
  };

  const { error } = await supabase.from("site_settings").upsert({
    key: "homepage_hero",
    value: value as Json,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/");
  revalidatePath("/admin/homepage");
  return { ok: true };
}
