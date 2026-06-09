"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActionUser } from "@/lib/auth";
import { toUserFacingError } from "@/lib/action-error";
import { canParticipateContestGroup } from "@/lib/permissions/user-groups";
import { createServerDataClient } from "@/lib/supabase/server-data";
import type { Json, VoteType } from "@/lib/types";

const groupVoteInputSchema = z.object({
  groupId: z.string().uuid(),
  votes: z
    .array(
      z.object({
        contestId: z.string().uuid(),
        payload: z.record(z.unknown()),
        loveCandidateIds: z.array(z.string().uuid()).default([]),
      }),
    )
    .min(1),
});

type GroupVoteInput = z.infer<typeof groupVoteInputSchema>;

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function friendlyGroupVoteWriteError(
  error?: { code?: string; message?: string } | null,
) {
  const message = error?.message ?? "";

  if (
    error?.code === "23505" ||
    /duplicate key|unique constraint/i.test(message)
  ) {
    return "你已经参与过其中部分活动投票，不能重复投票。";
  }

  if (/真爱票|额度|quota/i.test(message)) {
    return message;
  }

  return message || "提交组内投票失败，请稍后重试。";
}

function getSelectedCandidateIds(params: {
  voteType: VoteType;
  maxChoices: number;
  requireExactChoices: boolean;
  payload: Record<string, unknown>;
}) {
  const { voteType, maxChoices, requireExactChoices, payload } = params;

  if (voteType === "single") {
    const candidateId = payload.candidateId;
    if (typeof candidateId !== "string" || !candidateId) {
      return { error: "请选择一个候选项。" };
    }

    return { candidateIds: [candidateId] };
  }

  if (voteType === "multiple") {
    const rawCandidateIds = payload.candidateIds;
    if (!Array.isArray(rawCandidateIds)) {
      return { error: "请至少选择一个候选项。" };
    }

    const candidateIds = uniqueStrings(
      rawCandidateIds.filter((value): value is string => typeof value === "string"),
    );

    if (requireExactChoices && candidateIds.length !== maxChoices) {
      return { error: `该活动需要选择 ${maxChoices} 个候选项。` };
    }

    if (candidateIds.length < 1) {
      return { error: "请至少选择一个候选项。" };
    }

    if (candidateIds.length > maxChoices) {
      return { error: `最多选择 ${maxChoices} 个候选项。` };
    }

    return { candidateIds };
  }

  const rawRanking = payload.ranking;
  if (!Array.isArray(rawRanking)) {
    return { error: "请至少选择一个排名候选项。" };
  }

  const ranking = rawRanking.filter(
    (value): value is string => typeof value === "string" && Boolean(value),
  );
  const uniqueRanking = uniqueStrings(ranking);

  if (uniqueRanking.length < 1) {
    return { error: "请至少选择一个排名候选项。" };
  }

  if (uniqueRanking.length !== ranking.length) {
    return { error: "排名候选项不能重复。" };
  }

  if (uniqueRanking.length > 3) {
    return { error: "排名投票最多支持三个候选项。" };
  }

  return { candidateIds: uniqueRanking };
}

export async function submitGroupVotes(input: GroupVoteInput) {
  const userResult = await getActionUser();
  if (!userResult.ok) {
    return { ok: false, error: toUserFacingError(userResult.error) };
  }
  const user = userResult.profile;
  const parsed = groupVoteInputSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, error: "投票数据无效。" };
  }

  const groupId = parsed.data.groupId;
  const requestedVotes = parsed.data.votes;
  const contestIds = uniqueStrings(requestedVotes.map((vote) => vote.contestId));

  if (contestIds.length !== requestedVotes.length) {
    return { ok: false, error: "每个活动只能提交一次投票。" };
  }

  const supabase = await createServerDataClient();
  const { data: group, error: groupError } = await supabase
    .from("contest_groups")
    .select("id,love_vote_quota,love_vote_weight")
    .eq("id", groupId)
    .maybeSingle();

  if (groupError || !group) {
    return { ok: false, error: "活动组不存在。" };
  }

  const canParticipate = await canParticipateContestGroup({
    contestGroupId: groupId,
    profile: user,
  });

  if (!canParticipate) {
    return {
      ok: false,
      error: "你暂时没有参与该活动组投票的权限。",
    };
  }

  const [
    { data: contests, error: contestsError },
    { data: candidates, error: candidatesError },
    { data: existingVotes, error: existingVotesError },
    { count: existingLoveVoteCount, error: loveCountError },
  ] = await Promise.all([
    supabase
      .from("contests")
      .select("id,status,vote_type,max_choices,require_exact_choices,group_id,love_vote_enabled")
      .is("archived_at", null)
      .in("id", contestIds),
    supabase
      .from("candidates")
      .select("id,contest_id")
      .in("contest_id", contestIds)
      .eq("is_active", true),
    supabase
      .from("votes")
      .select("id,contest_id")
      .eq("voter_id", user.id)
      .in("contest_id", contestIds),
    supabase
      .from("love_vote_allocations")
      .select("id", { count: "exact", head: true })
      .eq("group_id", groupId)
      .eq("voter_id", user.id),
  ]);

  if (contestsError || candidatesError || existingVotesError || loveCountError) {
    return { ok: false, error: "无法校验投票请求。" };
  }

  const contestById = new Map((contests ?? []).map((contest) => [contest.id, contest]));
  const candidatesByContest = new Map<string, Set<string>>();

  for (const candidate of candidates ?? []) {
    const current = candidatesByContest.get(candidate.contest_id) ?? new Set<string>();
    current.add(candidate.id);
    candidatesByContest.set(candidate.contest_id, current);
  }

  const existingVoteContestIds = new Set(
    (existingVotes ?? []).map((vote) => vote.contest_id),
  );
  const preparedVotes: Array<{
    contestId: string;
    payload: Json;
    loveCandidateIds: string[];
  }> = [];
  let newLoveVoteCount = 0;

  for (const voteRequest of requestedVotes) {
    const contest = contestById.get(voteRequest.contestId);
    if (!contest || contest.group_id !== groupId) {
      return {
        ok: false,
        error: "提交的活动必须属于当前活动组。",
      };
    }

    if (contest.status !== "voting") {
      return { ok: false, error: "只能提交投票中的活动。" };
    }

    if (existingVoteContestIds.has(contest.id)) {
      return { ok: false, error: "你已经参与过该活动投票，不能重复投票。" };
    }

    const selected = getSelectedCandidateIds({
      voteType: contest.vote_type,
      maxChoices: contest.max_choices,
      requireExactChoices: contest.require_exact_choices === true,
      payload: voteRequest.payload,
    });

    if ("error" in selected) {
      return { ok: false, error: selected.error };
    }

    const contestCandidateIds = candidatesByContest.get(contest.id) ?? new Set<string>();
    if (selected.candidateIds.some((candidateId) => !contestCandidateIds.has(candidateId))) {
      return { ok: false, error: "选中的候选项不属于对应活动。" };
    }

    const selectedSet = new Set(selected.candidateIds);
    const loveCandidateIds = uniqueStrings(voteRequest.loveCandidateIds);

    if (loveCandidateIds.length > 0 && contest.love_vote_enabled === false) {
      return { ok: false, error: "该活动不可使用真爱票。" };
    }

    if (
      loveCandidateIds.length > 0 &&
      (group.love_vote_quota <= 0 || Number(group.love_vote_weight) <= 1)
    ) {
      return { ok: false, error: "该活动不可使用真爱票。" };
    }

    if (loveCandidateIds.some((candidateId) => !contestCandidateIds.has(candidateId))) {
      return { ok: false, error: "真爱票候选项不属于对应活动。" };
    }

    if (loveCandidateIds.some((candidateId) => !selectedSet.has(candidateId))) {
      return { ok: false, error: "真爱票只能给已选择的候选项。" };
    }

    newLoveVoteCount += loveCandidateIds.length;
    preparedVotes.push({
      contestId: contest.id,
      payload: voteRequest.payload as Json,
      loveCandidateIds,
    });
  }

  if ((existingLoveVoteCount ?? 0) + newLoveVoteCount > group.love_vote_quota) {
    return {
      ok: false,
      error: `该活动组最多可使用 ${group.love_vote_quota} 张真爱票。`,
    };
  }

  const { error: writeError } = await supabase.rpc("submit_group_votes_with_love", {
    p_group_id: groupId,
    p_voter_id: user.id,
    p_votes: preparedVotes as unknown as Json,
  });

  if (writeError) {
    return { ok: false, error: friendlyGroupVoteWriteError(writeError) };
  }

  for (const preparedVote of preparedVotes) {
    revalidatePath(`/contests/${preparedVote.contestId}`);
    revalidatePath(`/contests/${preparedVote.contestId}/results`);
  }

  revalidatePath(`/groups/${groupId}`);
  revalidatePath(`/groups/${groupId}/vote`);
  return { ok: true };
}
