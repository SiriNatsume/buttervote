"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActionAdmin } from "@/lib/auth";
import { toUserFacingError } from "@/lib/action-error";
import {
  buildContestCallingEvents,
  contestCallingEventToInsert,
} from "@/lib/contest-calling";
import { createRequiredServiceClient } from "@/lib/supabase/service";
import { fetchAllRows } from "@/lib/supabase-pagination";
import type { Candidate, Contest, LoveVoteAllocation, Vote } from "@/lib/types";

const generateCallingSchema = z.object({
  contestId: z.string().uuid(),
  seed: z.string().trim().max(120).optional(),
  autoIntervalSeconds: z.coerce.number().int().min(2).max(60).default(5),
});

const controlCallingSchema = z.object({
  sessionId: z.string().uuid(),
  intent: z.enum([
    "start",
    "pause",
    "resume",
    "next",
    "previous",
    "auto",
    "manual",
    "complete",
    "archive",
  ]),
  autoIntervalSeconds: z.coerce.number().int().min(2).max(60).optional(),
});

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

function formText(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function chunkRows<T>(rows: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

function buildSeed(contestId: string) {
  return `calling-${contestId}-${new Date().toISOString()}-${crypto.randomUUID()}`;
}

function revalidateCallingPaths(contest: Pick<Contest, "id" | "group_id">) {
  revalidatePath(`/contests/${contest.id}`);
  revalidatePath(`/contests/${contest.id}/results`);
  if (contest.group_id) {
    revalidatePath(`/groups/${contest.group_id}`);
    revalidatePath(`/groups/${contest.group_id}/results`);
  }
}

async function loadContestForCalling(contestId: string) {
  const supabase = createRequiredServiceClient();
  const { data: contest, error } = await supabase
    .from("contests")
    .select(
      "id,title,status,vote_type,group_id,love_vote_enabled,archived_at,closed_result_visibility",
    )
    .eq("id", contestId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return contest;
}

export async function generateContestCallingSessionAction(
  formData: FormData,
): Promise<ActionResult<{ sessionId?: string }>> {
  const adminResult = await getActionAdmin();
  if (!adminResult.ok) {
    return actionFailure(adminResult.error);
  }

  const parsed = generateCallingSchema.safeParse({
    contestId: formData.get("contestId"),
    seed: formText(formData.get("seed")) || undefined,
    autoIntervalSeconds: formData.get("autoIntervalSeconds") || 5,
  });

  if (!parsed.success) {
    return actionFailure(parsed.error.issues[0]?.message ?? "唱票参数无效。");
  }

  const supabase = createRequiredServiceClient();
  const contest = await loadContestForCalling(parsed.data.contestId);

  if (!contest || contest.archived_at) {
    return actionFailure("活动不存在或已归档。");
  }

  if (contest.status !== "closed" && contest.status !== "published") {
    return actionFailure("请在投票结束后再生成唱票。");
  }

  const [candidateResult, voteResult, groupResult] = await Promise.all([
    fetchAllRows<Candidate>(() =>
      supabase
        .from("candidates")
        .select(
          "id,contest_id,nomination_id,name,description,image_path,image_width,image_height,image_size,nominator_display_name,nominator_note,inherited_from_candidate_id,is_active,deleted_at,created_at",
        )
        .eq("contest_id", contest.id)
        .eq("is_active", true)
        .order("created_at", { ascending: true }),
    ),
    fetchAllRows<Vote>(() =>
      supabase
        .from("votes")
        .select("id,contest_id,voter_id,payload,created_at")
        .eq("contest_id", contest.id)
        .order("created_at", { ascending: true }),
    ),
    contest.group_id
      ? supabase
          .from("contest_groups")
          .select("id,love_vote_weight")
          .eq("id", contest.group_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (candidateResult.error || voteResult.error || groupResult.error) {
    return actionFailure(
      candidateResult.error?.message ??
        voteResult.error?.message ??
        groupResult.error?.message ??
        "读取唱票数据失败。",
    );
  }

  const loveResult =
    contest.group_id
      ? await fetchAllRows<Pick<LoveVoteAllocation, "vote_id" | "candidate_id">>(
          () =>
            supabase
              .from("love_vote_allocations")
              .select("vote_id,candidate_id")
              .eq("contest_id", contest.id),
        )
      : { data: [], error: null };

  if (loveResult.error) {
    return actionFailure(loveResult.error.message);
  }

  const seed = parsed.data.seed || buildSeed(contest.id);
  const events = buildContestCallingEvents({
    voteType: contest.vote_type,
    candidates: candidateResult.data,
    votes: voteResult.data,
    loveAllocations: loveResult.data ?? [],
    loveVoteWeight: groupResult.data ? Number(groupResult.data.love_vote_weight) : null,
    seed,
  });

  if (events.length === 0) {
    return actionFailure("暂无有效投票，无法生成唱票。");
  }

  const { data: session, error: sessionError } = await supabase
    .from("contest_calling_sessions")
    .insert({
      contest_id: contest.id,
      status: "draft",
      current_step: 0,
      total_steps: events.length,
      play_mode: "manual",
      auto_interval_seconds: parsed.data.autoIntervalSeconds,
      seed,
      created_by: adminResult.profile.id,
      metadata: {
        contestTitle: contest.title,
        generatedAt: new Date().toISOString(),
        baseEventCount: events.filter((event) => event.phase === "base").length,
        loveBonusEventCount: events.filter((event) => event.phase === "love_bonus").length,
      },
    })
    .select("id")
    .single();

  if (sessionError || !session) {
    return actionFailure(sessionError?.message ?? "创建唱票会话失败。");
  }

  const inserts = events.map((event) =>
    contestCallingEventToInsert(session.id, contest.id, event),
  );

  for (const chunk of chunkRows(inserts, 500)) {
    const { error } = await supabase.from("contest_calling_events").insert(chunk);
    if (error) {
      await supabase
        .from("contest_calling_sessions")
        .update({ status: "archived", archived_at: new Date().toISOString() })
        .eq("id", session.id);
      return actionFailure(error.message || "写入唱票事件失败。");
    }
  }

  await supabase
    .from("contest_calling_sessions")
    .update({ status: "archived", archived_at: new Date().toISOString() })
    .eq("contest_id", contest.id)
    .neq("id", session.id)
    .is("archived_at", null);

  revalidateCallingPaths(contest);

  return actionSuccess("已生成唱票。", { sessionId: session.id });
}

export async function controlContestCallingSessionAction(
  formData: FormData,
): Promise<ActionResult> {
  const adminResult = await getActionAdmin();
  if (!adminResult.ok) {
    return actionFailure(adminResult.error);
  }

  const parsed = controlCallingSchema.safeParse({
    sessionId: formData.get("sessionId"),
    intent: formData.get("intent"),
    autoIntervalSeconds: formData.get("autoIntervalSeconds") || undefined,
  });

  if (!parsed.success) {
    return actionFailure(parsed.error.issues[0]?.message ?? "唱票操作无效。");
  }

  const supabase = createRequiredServiceClient();
  const { data: session, error: sessionError } = await supabase
    .from("contest_calling_sessions")
    .select(
      "id,contest_id,status,current_step,total_steps,play_mode,auto_interval_seconds,archived_at,started_at,completed_at",
    )
    .eq("id", parsed.data.sessionId)
    .maybeSingle();

  if (sessionError || !session || session.archived_at || session.status === "archived") {
    return actionFailure(sessionError?.message ?? "唱票会话不存在或已归档。");
  }

  const contest = await loadContestForCalling(session.contest_id);
  if (!contest || contest.archived_at) {
    return actionFailure("活动不存在或已归档。");
  }

  const now = new Date().toISOString();
  const currentStep = Math.max(0, Number(session.current_step) || 0);
  const totalSteps = Math.max(0, Number(session.total_steps) || 0);
  const update: Record<string, unknown> = {};
  let message = "唱票状态已更新。";

  switch (parsed.data.intent) {
    case "start":
    case "resume":
      update.status = "active";
      update.play_mode = session.play_mode === "auto" ? "auto" : "manual";
      update.current_step = Math.min(totalSteps, Math.max(1, currentStep));
      update.started_at = session.started_at ?? now;
      update.completed_at = null;
      message = parsed.data.intent === "start" ? "唱票已开始。" : "唱票已继续。";
      break;
    case "pause":
      update.status = "paused";
      update.play_mode = "manual";
      message = "唱票已暂停。";
      break;
    case "next": {
      const nextStep = Math.min(totalSteps, currentStep + 1);
      update.current_step = nextStep;
      update.status = nextStep >= totalSteps ? "completed" : "active";
      update.play_mode = session.play_mode;
      update.started_at = session.started_at ?? now;
      update.completed_at = nextStep >= totalSteps ? now : null;
      message = nextStep >= totalSteps ? "唱票已完成。" : "已进入下一张。";
      break;
    }
    case "previous": {
      const previousStep = Math.max(0, currentStep - 1);
      update.current_step = previousStep;
      update.status = previousStep >= totalSteps && totalSteps > 0 ? "completed" : "paused";
      update.play_mode = "manual";
      update.completed_at = previousStep >= totalSteps && totalSteps > 0 ? session.completed_at ?? now : null;
      message = previousStep === 0 ? "已回到开场。" : "已回到上一张。";
      break;
    }
    case "auto":
      update.status = "active";
      update.play_mode = "auto";
      update.auto_interval_seconds = parsed.data.autoIntervalSeconds ?? session.auto_interval_seconds;
      update.started_at = session.started_at ?? now;
      update.completed_at = null;
      message = "自动唱票已开启。";
      break;
    case "manual":
      update.status = session.status === "completed" ? "completed" : "paused";
      update.play_mode = "manual";
      message = "已切换为手动唱票。";
      break;
    case "complete":
      update.status = "completed";
      update.play_mode = "manual";
      update.current_step = totalSteps;
      update.started_at = session.started_at ?? now;
      update.completed_at = now;
      message = "唱票已完成。";
      break;
    case "archive":
      update.status = "archived";
      update.play_mode = "manual";
      update.archived_at = now;
      message = "唱票已归档。";
      break;
    default:
      return actionFailure("未知唱票操作。");
  }

  const { error } = await supabase
    .from("contest_calling_sessions")
    .update(update)
    .eq("id", session.id);

  if (error) {
    return actionFailure(error.message || "更新唱票状态失败。");
  }

  revalidateCallingPaths(contest);
  return actionSuccess(message);
}
