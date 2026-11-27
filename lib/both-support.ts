import type { VoteType } from "@/lib/types";

export const BOTH_SUPPORT_CHOICE = "__both_support__";
export const BOTH_SUPPORT_LABEL = "同时支持两项";

export function isBothSupportVote(payload: unknown): boolean {
  return typeof payload === "object" && payload !== null &&
    "ballotType" in payload && payload.ballotType === "both_support";
}

/** Read the recorded pair, never substitute the contest's current candidates. */
export function bothSupportCandidateIds(payload: unknown): string[] {
  if (!isBothSupportVote(payload)) return [];
  const value = payload as Record<string, unknown>;
  const ids = value.candidateIds;
  if (Object.keys(value).some((key) => key !== "ballotType" && key !== "candidateIds") ||
    !Array.isArray(ids) || ids.length !== 2 ||
    ids.some((id) => typeof id !== "string" || !id) || ids[0] === ids[1]) return [];
  return ids as string[];
}

export function canUseBothSupport(
  contest: { vote_type: VoteType; both_support_enabled?: boolean },
  candidateCount: number,
) {
  return contest.vote_type === "single" && candidateCount === 2 &&
    contest.both_support_enabled !== false;
}

export function validateBothSupportVote(
  contest: { vote_type: VoteType; both_support_enabled?: boolean },
  candidateIds: ReadonlySet<string>,
  payload: unknown,
  loveCandidateIds: readonly string[] = [],
): string | null {
  if (!canUseBothSupport(contest, candidateIds.size)) {
    return "该活动当前不能同时支持两项，请刷新后重新选择。";
  }
  const selected = bothSupportCandidateIds(payload);
  if (selected.length !== 2 || selected.some((id) => !candidateIds.has(id))) {
    return "同时支持的两个选项必须与当前候选项一致，请刷新后重新选择。";
  }
  if (loveCandidateIds.length > 0) return "同时支持票不能使用或补投真爱票。";
  return null;
}
