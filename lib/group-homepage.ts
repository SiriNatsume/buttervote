import type { ContestStatus, VoteType } from "@/lib/types";

export const GROUP_HOMEPAGE_RECENT_RESULT_LIMIT = 20;

export type GroupHomepageParticipant = {
  id: string;
  name: string;
  imageUrl: string | null;
  score: number | null;
  normalScore: number | null;
  loveScore: number | null;
  loveVoteCount: number | null;
  isWinner: boolean;
};

export type GroupHomepageContest = {
  id: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  status: ContestStatus;
  voteType: VoteType;
  votingStartsAt: string | null;
  votingEndsAt: string | null;
  updatedAt: string;
  resultVisible: boolean;
  breakdownVisible: boolean;
  loveVoteWeight: number | null;
  participants: GroupHomepageParticipant[];
  searchText: string;
};

const contestTitleCollator = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base",
});

export function sortGroupContestsByTitle(contests: GroupHomepageContest[]) {
  return [...contests].sort((left, right) =>
    contestTitleCollator.compare(left.title, right.title),
  );
}

export function sortRecentGroupContests(contests: GroupHomepageContest[]) {
  return [...contests].sort((left, right) => {
    const leftTime = Date.parse(left.votingEndsAt ?? left.updatedAt);
    const rightTime = Date.parse(right.votingEndsAt ?? right.updatedAt);
    return rightTime - leftTime;
  });
}

export function resolveGroupHomepageResultAvailability(input: {
  status: ContestStatus;
  fullResultsVisible: boolean;
  showWeightedLoveScore: boolean;
  resultDataAvailable: boolean;
  tallyComplete: boolean;
}) {
  const scoresVisible =
    input.fullResultsVisible &&
    input.resultDataAvailable &&
    input.tallyComplete;
  const breakdownVisible =
    scoresVisible &&
    (input.status === "closed" || input.status === "published") &&
    input.showWeightedLoveScore;

  return { scoresVisible, breakdownVisible };
}

export function partitionGroupHomepageContests(
  contests: GroupHomepageContest[],
) {
  return {
    ongoing: sortGroupContestsByTitle(
      contests.filter(
        (contest) =>
          contest.status === "nominating" || contest.status === "voting",
      ),
    ),
    upcoming: sortGroupContestsByTitle(
      contests.filter((contest) => contest.status === "waiting"),
    ),
    recent: sortRecentGroupContests(
      contests.filter(
        (contest) =>
          contest.status === "closed" || contest.status === "published",
      ),
    ),
  };
}

export function groupContestMatchesQuery(
  contest: GroupHomepageContest,
  query: string,
) {
  const normalized = query.trim().normalize("NFKC").toLocaleLowerCase("zh-CN");
  return !normalized || contest.searchText.includes(normalized);
}

export function contestRelativeTimeTarget(contest: GroupHomepageContest) {
  if (contest.status === "nominating" || contest.status === "waiting") {
    return contest.votingStartsAt;
  }
  if (contest.status === "voting") return contest.votingEndsAt;
  if (contest.status === "closed" || contest.status === "published") {
    return contest.votingEndsAt ?? contest.updatedAt;
  }
  return null;
}

export type ContestRelativeTimeMode = "starts" | "ends" | "ended";

export function contestRelativeTimeMode(
  contest: GroupHomepageContest,
): ContestRelativeTimeMode | null {
  if (contest.status === "waiting") return "starts";
  if (contest.status === "nominating" || contest.status === "voting") {
    return "ends";
  }
  if (contest.status === "closed" || contest.status === "published") {
    return "ended";
  }
  return null;
}
