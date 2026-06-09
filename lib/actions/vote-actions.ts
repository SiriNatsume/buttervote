"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActionUser } from "@/lib/auth";
import { toUserFacingError } from "@/lib/action-error";
import { canParticipateContestGroup } from "@/lib/permissions/user-groups";
import { createServerDataClient } from "@/lib/supabase/server-data";
import type { Json, VoteType } from "@/lib/types";

const baseVoteSchema = z.object({
  contestId: z.string().uuid(),
  voteType: z.enum(["single", "multiple", "ranked"]),
});

function voteError(message: string) {
  return { ok: false as const, error: toUserFacingError(message) };
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function friendlyVoteWriteError(error?: { code?: string; message?: string } | null) {
  const message = error?.message ?? "";

  if (
    error?.code === "23505" ||
    /duplicate key|unique constraint/i.test(message)
  ) {
    return "你已经参与过该活动投票，不能重复投票。";
  }

  if (/真爱票|额度|quota/i.test(message)) {
    return message;
  }

  return message || "保存投票失败，请稍后重试。";
}

export async function submitVoteAction(formData: FormData) {
  const userResult = await getActionUser();
  if (!userResult.ok) {
    return voteError(userResult.error);
  }
  const user = userResult.profile;
  const parsed = baseVoteSchema.safeParse({
    contestId: formData.get("contestId"),
    voteType: formData.get("voteType"),
  });

  if (!parsed.success) {
    return voteError("投票请求无效。");
  }

  const { contestId, voteType } = parsed.data;
  const supabase = await createServerDataClient();

  const { data: contest } = await supabase
    .from("contests")
    .select("id,status,vote_type,max_choices,require_exact_choices,group_id,love_vote_enabled,archived_at")
    .eq("id", contestId)
    .maybeSingle();

  if (!contest || contest.archived_at || contest.status !== "voting") {
    return voteError("该活动当前不能投票。");
  }

  if (contest.vote_type !== voteType) {
    return voteError("投票类型不匹配。");
  }

  if (contest.group_id) {
    const canParticipate = await canParticipateContestGroup({
      contestGroupId: contest.group_id,
      profile: user,
    });

    if (!canParticipate) {
      return voteError("你暂时没有参与该活动组投票的权限。");
    }
  }

  const { data: existingVote } = await supabase
    .from("votes")
    .select("id")
    .eq("contest_id", contestId)
    .eq("voter_id", user.id)
    .maybeSingle();

  if (existingVote) {
    return voteError("你已经参与过该活动投票，不能重复投票。");
  }

  const { data: candidates } = await supabase
    .from("candidates")
    .select("id")
    .eq("contest_id", contestId)
    .eq("is_active", true);

  const candidateIds = new Set((candidates ?? []).map((candidate) => candidate.id));
  let payload: Record<string, string | string[]>;
  let selectedCandidateIds: string[] = [];

  if (voteType === "single") {
    const candidateId = String(formData.get("candidateId") ?? "");
    if (!candidateIds.has(candidateId)) {
      return voteError("请选择有效候选项。");
    }
    payload = { candidateId };
    selectedCandidateIds = [candidateId];
  } else if (voteType === "multiple") {
    const selectedIds = uniqueStrings(
      formData.getAll("candidateIds").map((value) => String(value)),
    );

    if (
      contest.require_exact_choices === true &&
      selectedIds.length !== contest.max_choices
    ) {
      return voteError(`该活动需要选择 ${contest.max_choices} 项。`);
    }

    if (selectedIds.length < 1) {
      return voteError("请至少选择一个候选项。");
    }

    if (selectedIds.length > contest.max_choices) {
      return voteError(`最多只能选择 ${contest.max_choices} 项。`);
    }

    if (selectedIds.some((candidateId) => !candidateIds.has(candidateId))) {
      return voteError("候选项不属于当前活动。");
    }

    payload = { candidateIds: selectedIds };
    selectedCandidateIds = selectedIds;
  } else {
    const ranking = uniqueStrings(
      ["rank1", "rank2", "rank3"]
        .map((name) => String(formData.get(name) ?? ""))
        .filter(Boolean),
    );
    const rawRanking = ["rank1", "rank2", "rank3"]
      .map((name) => String(formData.get(name) ?? ""))
      .filter(Boolean);

    if (ranking.length < 1) {
      return voteError("请至少选择一个排名候选项。");
    }

    if (ranking.length !== rawRanking.length) {
      return voteError("排名不能选择重复候选项。");
    }

    if (ranking.some((candidateId) => !candidateIds.has(candidateId))) {
      return voteError("候选项不属于当前活动。");
    }

    payload = { ranking };
    selectedCandidateIds = ranking;
  }

  const loveCandidateIds = uniqueStrings(
    formData.getAll("loveCandidateIds").map((value) => String(value)),
  );

  if (loveCandidateIds.length > 0) {
    const selectedSet = new Set(selectedCandidateIds);

    if (!contest.group_id || contest.love_vote_enabled === false) {
      return voteError("该活动不可使用真爱票。");
    }

    if (loveCandidateIds.some((candidateId) => !candidateIds.has(candidateId))) {
      return voteError("真爱票候选项不属于当前活动。");
    }

    if (loveCandidateIds.some((candidateId) => !selectedSet.has(candidateId))) {
      return voteError("真爱票只能投给本次已选择的候选项。");
    }

    const [{ data: group }, { count: existingLoveVoteCount }] =
      await Promise.all([
        supabase
          .from("contest_groups")
          .select("id,love_vote_quota,love_vote_weight")
          .eq("id", contest.group_id)
          .maybeSingle(),
        supabase
          .from("love_vote_allocations")
          .select("id", { count: "exact", head: true })
          .eq("group_id", contest.group_id)
          .eq("voter_id", user.id),
      ]);

    if (
      !group ||
      group.love_vote_quota <= 0 ||
      Number(group.love_vote_weight) <= 1
    ) {
      return voteError("该活动不可使用真爱票。");
    }

    if ((existingLoveVoteCount ?? 0) + loveCandidateIds.length > group.love_vote_quota) {
      return voteError(`你的真爱票额度不足，最多可使用 ${group.love_vote_quota} 张。`);
    }
  }

  const { error } = await supabase.rpc("submit_vote_with_love", {
    p_contest_id: contestId,
    p_voter_id: user.id,
    p_payload: payload as Json,
    p_love_candidate_ids: loveCandidateIds,
  });

  if (error) {
    return voteError(friendlyVoteWriteError(error));
  }

  revalidatePath(`/contests/${contestId}`);
  revalidatePath(`/contests/${contestId}/results`);
  if (contest.group_id) {
    revalidatePath(`/groups/${contest.group_id}`);
    revalidatePath(`/groups/${contest.group_id}/vote`);
  }
  return { ok: true as const, redirectTo: `/contests/${contestId}?voted=1` };
}

export type VoteFormType = VoteType;
