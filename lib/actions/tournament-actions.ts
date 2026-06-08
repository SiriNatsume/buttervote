"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActionAdmin } from "@/lib/auth";
import { toUserFacingError } from "@/lib/action-error";
import {
  buildPreliminaryPools,
  drawPreliminaryGroups,
  resolveScreeningAdvancers,
  type PreliminaryGroupKey,
} from "@/lib/tournament-rules";
import { createRequiredServiceClient } from "@/lib/supabase/service";
import { tallyVotes, type TallyResult } from "@/lib/tally";
import type { Json, LoveVoteAllocation, Vote } from "@/lib/types";

type ActionResult<T extends Record<string, unknown> = Record<string, unknown>> =
  | ({ ok: true; message?: string } & T)
  | { ok: false; error: string };

const createTournamentSchema = z.object({
  name: z.string().trim().min(1, "赛事名称不能为空").max(160),
  screeningContestId: z.string().uuid("请选择海选活动"),
});

const generatePreliminarySchema = z.object({
  tournamentId: z.string().uuid(),
  targetGroupId: z.string().uuid().nullable(),
  seed: z.string().trim().max(160).optional(),
});

function actionSuccess<T extends Record<string, unknown> = Record<string, unknown>>(
  message?: string,
  extra?: T,
): ActionResult<T> {
  return { ok: true, ...(message ? { message } : {}), ...(extra ?? ({} as T)) };
}

function actionFailure(message: string): ActionResult {
  return { ok: false, error: toUserFacingError(message) };
}

function optionalUuidFromForm(value: FormDataEntryValue | null) {
  const text = String(value ?? "");
  return text && text !== "none" ? text : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonString(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function extractStringArray(value: unknown, key: string) {
  if (!isRecord(value)) {
    return [];
  }

  const rawValue = value[key];
  return Array.isArray(rawValue)
    ? rawValue.filter((item): item is string => typeof item === "string")
    : [];
}

async function getScreeningResults(contestId: string) {
  const supabase = createRequiredServiceClient();
  const { data: contest, error: contestError } = await supabase
    .from("contests")
    .select("id,title,status,vote_type,group_id")
    .eq("id", contestId)
    .maybeSingle();

  if (contestError || !contest) {
    return {
      ok: false as const,
      error: contestError?.message ?? "海选活动不存在。",
    };
  }

  const [
    { data: candidates, error: candidatesError },
    { data: votes, error: votesError },
    { data: group },
    { data: loveRows, error: loveRowsError },
  ] = await Promise.all([
    supabase
      .from("candidates")
      .select(
        "id,name,description,image_path,nominator_display_name,is_active,created_at",
      )
      .eq("contest_id", contestId)
      .eq("is_active", true)
      .order("created_at", { ascending: true }),
    supabase
      .from("votes")
      .select("id,contest_id,voter_id,payload,created_at")
      .eq("contest_id", contestId)
      .order("created_at", { ascending: true }),
    contest.group_id
      ? supabase
          .from("contest_groups")
          .select("id,love_vote_weight")
          .eq("id", contest.group_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    contest.group_id
      ? supabase
          .from("love_vote_allocations")
          .select("vote_id,candidate_id")
          .eq("contest_id", contestId)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (candidatesError || votesError || loveRowsError) {
    return {
      ok: false as const,
      error:
        candidatesError?.message ??
        votesError?.message ??
        loveRowsError?.message ??
        "读取海选结果失败。",
    };
  }

  const results = tallyVotes({
    voteType: contest.vote_type,
    candidates: candidates ?? [],
    votes: (votes ?? []) as Vote[],
    loveVoteWeight: group ? Number(group.love_vote_weight) : null,
    loveAllocations:
      (loveRows ?? []) as Array<
        Pick<LoveVoteAllocation, "vote_id" | "candidate_id">
      >,
  });

  return {
    ok: true as const,
    contest,
    results,
  };
}

function toCandidatePayload(result: TallyResult) {
  return {
    candidateId: result.candidateId,
    name: result.name,
    score: result.score,
    lastVoteAt: result.lastVoteAt,
    rank: result.rank,
    position: result.position,
  };
}

export async function createTournamentAction(
  formData: FormData,
): Promise<ActionResult> {
  const adminResult = await getActionAdmin();
  if (!adminResult.ok) {
    return actionFailure(adminResult.error);
  }

  const parsed = createTournamentSchema.safeParse({
    name: formData.get("name"),
    screeningContestId: formData.get("screeningContestId"),
  });

  if (!parsed.success) {
    return actionFailure(parsed.error.issues[0]?.message ?? "赛事信息无效。");
  }

  try {
    const supabase = createRequiredServiceClient();
    const { data, error } = await supabase.rpc(
      "create_tournament_with_screening_stage_atomic",
      {
        p_name: parsed.data.name,
        p_screening_contest_id: parsed.data.screeningContestId,
        p_config: {
          format: "butter_vote_tournament_v1",
          stages: {
            screening: { durationHours: 72, advancerLimit: 48 },
            preliminary: { durationHours: 72, maxChoices: 4 },
            tiebreaker: { durationHours: 24, maxChoices: 1 },
            knockout: { durationHours: 48, maxChoices: 1 },
          },
        } satisfies Json,
        p_created_by: adminResult.profile.id,
      },
    );

    if (error) {
      return actionFailure(error.message);
    }

    const tournamentId = isRecord(data) ? data.tournamentId : null;
    revalidatePath("/admin");
    revalidatePath("/admin/tournaments");
    revalidatePath(`/contests/${parsed.data.screeningContestId}/results`);

    return actionSuccess("赛事已创建", {
      redirectTo:
        typeof tournamentId === "string"
          ? `/admin/tournaments?tournament=${tournamentId}`
          : "/admin/tournaments",
    });
  } catch (error) {
    return actionFailure(error instanceof Error ? error.message : "创建赛事失败。");
  }
}

export async function generatePreliminaryStageAction(
  formData: FormData,
): Promise<ActionResult> {
  const adminResult = await getActionAdmin();
  if (!adminResult.ok) {
    return actionFailure(adminResult.error);
  }

  const parsed = generatePreliminarySchema.safeParse({
    tournamentId: formData.get("tournamentId"),
    targetGroupId: optionalUuidFromForm(formData.get("targetGroupId")),
    seed: String(formData.get("seed") ?? "").trim() || undefined,
  });

  if (!parsed.success) {
    return actionFailure(parsed.error.issues[0]?.message ?? "预赛生成请求无效。");
  }

  try {
    const supabase = createRequiredServiceClient();
    const [
      { data: tournament, error: tournamentError },
      { data: screeningStage, error: screeningStageError },
    ] = await Promise.all([
      supabase
        .from("tournaments")
        .select("id,name")
        .eq("id", parsed.data.tournamentId)
        .maybeSingle(),
      supabase
        .from("tournament_stages")
        .select("id,contest_id")
        .eq("tournament_id", parsed.data.tournamentId)
        .eq("kind", "screening")
        .order("sequence", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

    if (tournamentError || !tournament) {
      return actionFailure(tournamentError?.message ?? "赛事不存在。");
    }

    if (screeningStageError || !screeningStage?.contest_id) {
      return actionFailure(screeningStageError?.message ?? "赛事尚未关联海选活动。");
    }

    const screening = await getScreeningResults(screeningStage.contest_id);
    if (!screening.ok) {
      return actionFailure(screening.error);
    }

    if (!["closed", "published"].includes(screening.contest.status)) {
      return actionFailure("请先结束海选活动，再生成预赛。");
    }

    const seed =
      parsed.data.seed ??
      `preliminary:${parsed.data.tournamentId}:${new Date().toISOString()}`;
    const screeningResolution = resolveScreeningAdvancers(screening.results, 48);

    if (screeningResolution.advancers.length === 0) {
      return actionFailure("海选暂无可晋级候选项。");
    }

    const pools = buildPreliminaryPools(screeningResolution.advancers, seed);
    const groups = drawPreliminaryGroups(pools.pool1, pools.pool2, seed);
    const groupPayload = (Object.entries(groups) as Array<
      [PreliminaryGroupKey, TallyResult[]]
    >).map(([group, candidates]) => ({
      group,
      candidates: candidates.map((candidate) => ({
        candidateId: candidate.candidateId,
        screeningRank: candidate.resolvedRank,
      })),
    }));
    const input = {
      screeningContestId: screeningStage.contest_id,
      advancerLimit: 48,
      boundary: {
        score: screeningResolution.boundary.score,
        cutoffPosition: screeningResolution.boundary.cutoffPosition,
        isExtendedByTie: screeningResolution.boundary.isExtendedByTie,
        extraAdvancerCount: screeningResolution.boundary.extraAdvancerCount,
        tiedCandidates: screeningResolution.boundary.tiedCandidates.map(
          toCandidatePayload,
        ),
      },
      advancers: screeningResolution.advancers.map(toCandidatePayload),
      pool1: pools.pool1.map(toCandidatePayload),
      pool2: pools.pool2.map(toCandidatePayload),
      randomizedPoolBoundary: pools.randomizedBoundaryCandidates.map(
        toCandidatePayload,
      ),
    };
    const output = {
      groups: Object.fromEntries(
        (Object.entries(groups) as Array<[PreliminaryGroupKey, TallyResult[]]>).map(
          ([group, candidates]) => [group, candidates.map(toCandidatePayload)],
        ),
      ),
      groupSizes: Object.fromEntries(
        (Object.entries(groups) as Array<[PreliminaryGroupKey, TallyResult[]]>).map(
          ([group, candidates]) => [group, candidates.length],
        ),
      ),
    };

    const { data, error } = await supabase.rpc("create_preliminary_stage_atomic", {
      p_tournament_id: parsed.data.tournamentId,
      p_screening_stage_id: screeningStage.id,
      p_target_group_id: parsed.data.targetGroupId,
      p_seed: seed,
      p_input: input as Json,
      p_output: output as Json,
      p_groups: groupPayload as Json,
      p_created_by: adminResult.profile.id,
    });

    if (error) {
      return actionFailure(error.message);
    }

    const contestIds = extractStringArray(data, "contestIds");
    revalidatePath("/admin");
    revalidatePath("/admin/tournaments");
    revalidatePath(`/contests/${screeningStage.contest_id}/results`);

    for (const contestId of contestIds) {
      revalidatePath(`/admin/contests/${contestId}/edit`);
      revalidatePath(`/contests/${contestId}`);
      revalidatePath(`/contests/${contestId}/results`);
    }

    if (parsed.data.targetGroupId) {
      revalidatePath(`/admin/groups/${parsed.data.targetGroupId}`);
      revalidatePath(`/groups/${parsed.data.targetGroupId}`);
    }

    return actionSuccess(
      `已生成预赛 A/B/C/D 四组，共继承 ${
        isRecord(data) && typeof data.entryCount === "number"
          ? data.entryCount
          : screeningResolution.advancers.length
      } 个候选项`,
      {
        refresh: true,
        seed,
        input: jsonString(input),
        output: jsonString(output),
      },
    );
  } catch (error) {
    return actionFailure(error instanceof Error ? error.message : "生成预赛失败。");
  }
}
