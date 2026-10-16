export function contestVoteHref(contestId: string, groupId: string | null) {
  return groupId
    ? `/groups/${groupId}/vote`
    : `/contests/${contestId}/vote`;
}
