import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getPublicImageUrl } from "@/lib/image/image-url";
import {
  resolveGroupHomepageResultAvailability,
  type GroupHomepageContest,
} from "@/lib/group-homepage";
import { loadContestResultVisibilityByContest } from "@/lib/result-visibility";
import type { Candidate, Contest, Database } from "@/lib/types";
import {
  loadVisibleContestTallies,
  type VisibleContestTallyRow,
} from "@/lib/visible-result-tallies";

type DataClient = SupabaseClient<Database>;
type HomepageContestRow = Pick<
  Contest,
  | "id"
  | "title"
  | "description"
  | "image_path"
  | "status"
  | "vote_type"
  | "live_results_enabled"
  | "voting_starts_at"
  | "voting_ends_at"
  | "updated_at"
>;
type HomepageCandidate = Pick<
  Candidate,
  | "id"
  | "contest_id"
  | "name"
  | "description"
  | "image_path"
  | "nominator_display_name"
  | "is_active"
  | "created_at"
>;

function compareCandidatesByTally(
  left: HomepageCandidate,
  right: HomepageCandidate,
  tallyByCandidate: Map<string, VisibleContestTallyRow>,
) {
  const leftResult = tallyByCandidate.get(left.id);
  const rightResult = tallyByCandidate.get(right.id);
  const scoreDifference = (rightResult?.score ?? 0) - (leftResult?.score ?? 0);
  if (scoreDifference !== 0) return scoreDifference;

  const leftLastVoteAt = leftResult?.last_vote_at ?? null;
  const rightLastVoteAt = rightResult?.last_vote_at ?? null;
  if (leftLastVoteAt && rightLastVoteAt) {
    return leftLastVoteAt.localeCompare(rightLastVoteAt);
  }
  if (leftLastVoteAt) return -1;
  if (rightLastVoteAt) return 1;
  return left.name.localeCompare(right.name, "zh-Hans");
}

export async function loadGroupHomepageContests(params: {
  publicClient: DataClient;
  contests: HomepageContestRow[];
  loveVoteWeight: number;
}): Promise<GroupHomepageContest[]> {
  const { publicClient, contests, loveVoteWeight } = params;
  const contestIds = contests.map((contest) => contest.id);
  if (contestIds.length === 0) return [];

  const [visibilityByContest, candidateResult] = await Promise.all([
    loadContestResultVisibilityByContest(publicClient, contests, {
      // SECURITY CRITICAL: the group homepage is a public presentation.
      // It must never reveal admin-only results, even to an admin viewer.
      includeAdminOverride: false,
    }),
    publicClient
      .from("candidates")
      .select(
        "id,contest_id,name,description,image_path,nominator_display_name,is_active,created_at",
      )
      .in("contest_id", contestIds)
      .eq("is_active", true)
      .order("created_at", { ascending: true }),
  ]);

  if (candidateResult.error) {
    console.error(
      `[group-homepage] candidate query failed: ${candidateResult.error.message}`,
    );
  }
  const candidates = (candidateResult.data ?? []) as HomepageCandidate[];
  const candidatesByContest = new Map<string, HomepageCandidate[]>();
  for (const candidate of candidates) {
    const current = candidatesByContest.get(candidate.contest_id) ?? [];
    current.push(candidate);
    candidatesByContest.set(candidate.contest_id, current);
  }

  const scoreVisibleContestIds = contests
    .filter(
      (contest) =>
        visibilityByContest.get(contest.id)?.fullResultsVisible === true,
    )
    .map((contest) => contest.id);
  const resultData = await loadVisibleContestTallies(
    publicClient,
    scoreVisibleContestIds,
    { includeAdminOverride: false },
  );
  if (resultData.error) {
    console.error(
      `[group-homepage] result query failed: ${resultData.error.message}`,
    );
  }

  const talliesByContest = new Map<
    string,
    Map<string, VisibleContestTallyRow>
  >();
  for (const tally of resultData.tallies) {
    const current = talliesByContest.get(tally.contest_id) ?? new Map();
    current.set(tally.candidate_id, tally);
    talliesByContest.set(tally.contest_id, current);
  }

  return contests.map((contest) => {
    const contestCandidates = candidatesByContest.get(contest.id) ?? [];
    const visibility = visibilityByContest.get(contest.id);
    const tallyByCandidate = talliesByContest.get(contest.id) ?? new Map();
    const tallyComplete = contestCandidates.every((candidate) =>
      tallyByCandidate.has(candidate.id),
    );
    const { scoresVisible, breakdownVisible } =
      resolveGroupHomepageResultAvailability({
        status: contest.status,
        fullResultsVisible: visibility?.fullResultsVisible === true,
        showWeightedLoveScore: visibility?.showWeightedLoveScore === true,
        resultDataAvailable: resultData.error === null,
        tallyComplete,
      });
    const orderedByResult = scoresVisible
      ? [...contestCandidates].sort((left, right) =>
          compareCandidatesByTally(left, right, tallyByCandidate),
        )
      : contestCandidates;
    const finalOrder =
      scoresVisible && contestCandidates.length > 2
        ? orderedByResult
        : contestCandidates;
    const winnerCandidateId = scoresVisible ? orderedByResult[0]?.id : null;
    const participants = finalOrder.map((candidate) => {
      const result = tallyByCandidate.get(candidate.id);
      return {
        id: candidate.id,
        name: candidate.name,
        imageUrl: getPublicImageUrl(candidate.image_path),
        score: scoresVisible ? (result?.score ?? 0) : null,
        normalScore: breakdownVisible ? (result?.normal_score ?? 0) : null,
        loveScore: breakdownVisible ? (result?.love_score ?? 0) : null,
        loveVoteCount: breakdownVisible
          ? (result?.love_vote_count ?? 0)
          : null,
        isWinner:
          scoresVisible &&
          (contest.status === "closed" || contest.status === "published") &&
          candidate.id === winnerCandidateId,
      };
    });
    const searchText = [
      contest.title,
      contest.description,
      ...contestCandidates.map((candidate) => candidate.name),
    ]
      .filter(Boolean)
      .join(" ")
      .normalize("NFKC")
      .toLocaleLowerCase("zh-CN");

    return {
      id: contest.id,
      title: contest.title,
      description: contest.description,
      imageUrl: getPublicImageUrl(contest.image_path),
      status: contest.status,
      voteType: contest.vote_type,
      votingStartsAt: contest.voting_starts_at,
      votingEndsAt: contest.voting_ends_at,
      updatedAt: contest.updated_at,
      resultVisible: scoresVisible,
      breakdownVisible,
      loveVoteWeight: breakdownVisible ? loveVoteWeight : null,
      participants,
      searchText,
    };
  });
}
