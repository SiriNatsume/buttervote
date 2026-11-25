export const LOVE_VOTE_SUPPLEMENT_ID = "supplement-love-votes";

export function contestVoteHref(contestId: string, groupId: string | null) {
  return groupId
    ? `/groups/${groupId}/vote`
    : `/contests/${contestId}/vote`;
}
