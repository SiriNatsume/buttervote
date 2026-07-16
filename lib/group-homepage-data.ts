import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getPublicImageUrl } from "@/lib/image/image-url";
import type { GroupHomepageContest } from "@/lib/group-homepage";
import { loadContestResultVisibilityByContest } from "@/lib/result-visibility";
import { tallyVotes } from "@/lib/tally";
import type {
  Candidate,
  Contest,
  Database,
  LoveVoteAllocation,
  Vote,
} from "@/lib/types";
import { loadVisibleContestResultData } from "@/lib/visible-result-data";

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
  const resultData = await loadVisibleContestResultData(
    publicClient,
    scoreVisibleContestIds,
    { includeAdminOverride: false },
  );
  if (resultData.error) {
    console.error(
      `[group-homepage] result query failed: ${resultData.error.message}`,
    );
  }

  const votesByContest = new Map<string, Vote[]>();
  for (const vote of resultData.votes) {
    const current = votesByContest.get(vote.contest_id) ?? [];
    current.push({ ...vote, voter_id: null });
    votesByContest.set(vote.contest_id, current);
  }
  const loveByContest = new Map<
    string,
    Array<Pick<LoveVoteAllocation, "vote_id" | "candidate_id">>
  >();
  for (const allocation of resultData.loveAllocations) {
    const current = loveByContest.get(allocation.contest_id) ?? [];
    current.push({
      vote_id: allocation.vote_id,
      candidate_id: allocation.candidate_id,
    });
    loveByContest.set(allocation.contest_id, current);
  }

  return contests.map((contest) => {
    const contestCandidates = candidatesByContest.get(contest.id) ?? [];
    const visibility = visibilityByContest.get(contest.id);
    const scoresVisible = visibility?.fullResultsVisible === true;
    const breakdownVisible =
      scoresVisible &&
      (contest.status === "closed" || contest.status === "published") &&
      visibility?.showWeightedLoveScore === true;
    const tally = scoresVisible
      ? tallyVotes({
          voteType: contest.vote_type,
          candidates: contestCandidates,
          votes: votesByContest.get(contest.id) ?? [],
          loveVoteWeight,
          // SECURITY CRITICAL: live results are base scores. The visibility
          // RPC also withholds live love allocations from non-admin callers.
          loveVoteScoreMode:
            contest.status === "voting" || !visibility?.showWeightedLoveScore
              ? "base"
              : "weighted",
          loveAllocations: loveByContest.get(contest.id) ?? [],
        })
      : [];
    const tallyByCandidate = new Map(tally.map((result) => [result.candidateId, result]));
    const finalOrder =
      scoresVisible &&
      contestCandidates.length > 2
        ? tally.map((result) =>
            contestCandidates.find((candidate) => candidate.id === result.candidateId),
          ).filter((candidate): candidate is HomepageCandidate => Boolean(candidate))
        : contestCandidates;
    const participants = finalOrder.map((candidate) => {
      const result = tallyByCandidate.get(candidate.id);
      return {
        id: candidate.id,
        name: candidate.name,
        imageUrl: getPublicImageUrl(candidate.image_path),
        score: scoresVisible ? (result?.score ?? 0) : null,
        normalScore: scoresVisible ? (result?.normalScore ?? 0) : null,
        loveScore: breakdownVisible ? (result?.loveScore ?? 0) : null,
        loveVoteCount: breakdownVisible ? (result?.loveVoteCount ?? 0) : null,
        isWinner:
          scoresVisible &&
          (contest.status === "closed" || contest.status === "published") &&
          result?.position === 1,
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
