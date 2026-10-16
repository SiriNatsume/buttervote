import type { Contest } from "./types";

type GroupVoteRule = Pick<
  Contest,
  "vote_type" | "max_choices" | "require_exact_choices"
>;

export type ContestSelection = {
  candidateId: string;
  candidateIds: string[];
  ranking: string[];
  loveCandidateIds: string[];
};

export function emptySelection(): ContestSelection {
  return {
    candidateId: "",
    candidateIds: [],
    ranking: ["", "", ""],
    loveCandidateIds: [],
  };
}

export function selectedIdsForContest(
  contest: GroupVoteRule,
  selection: ContestSelection,
) {
  if (contest.vote_type === "single") {
    return selection.candidateId ? [selection.candidateId] : [];
  }

  if (contest.vote_type === "multiple") {
    return selection.candidateIds;
  }

  return selection.ranking.filter(Boolean);
}

export function isContestSelectionComplete(
  contest: GroupVoteRule,
  selection: ContestSelection,
) {
  const selectedIds = selectedIdsForContest(contest, selection);
  if (selectedIds.length === 0 || new Set(selectedIds).size !== selectedIds.length) {
    return false;
  }

  if (contest.vote_type === "multiple") {
    return contest.require_exact_choices === true
      ? selectedIds.length === contest.max_choices
      : selectedIds.length <= contest.max_choices;
  }

  return contest.vote_type === "single" || selectedIds.length <= 3;
}

export function groupVoteContests<
  T extends { existingVoteId?: string | null; candidates: readonly unknown[] },
>(contests: readonly T[]) {
  return {
    pending: contests.filter(
      (contest) => !contest.existingVoteId && contest.candidates.length > 0,
    ),
    unavailable: contests.filter(
      (contest) => !contest.existingVoteId && contest.candidates.length === 0,
    ),
    voted: contests.filter((contest) => Boolean(contest.existingVoteId)),
  };
}
