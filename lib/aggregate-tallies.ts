import { rankTallyResults, type TallyResult } from "@/lib/tally";
import type { Candidate } from "@/lib/types";
import type { VisibleContestTallyRow } from "@/lib/visible-result-tallies";
import { visibleTallyScore } from "@/lib/visible-tally-score";

export function tallyResultsFromAggregates({
  candidates,
  tallies,
  loveVoteWeight,
  showWeightedLoveScore,
}: {
  candidates: Array<Pick<Candidate, "id" | "name" | "description" | "image_path" | "nominator_display_name" | "is_active">>;
  tallies: VisibleContestTallyRow[];
  loveVoteWeight: number;
  showWeightedLoveScore: boolean;
}): TallyResult[] {
  const byCandidate = new Map(tallies.map((tally) => [tally.candidate_id, tally]));
  // A missing aggregate is unavailable data, not a zero-vote candidate.
  if (candidates.some((candidate) => !byCandidate.has(candidate.id))) return [];
  return rankTallyResults(candidates.map((candidate) => {
    const tally = byCandidate.get(candidate.id)!;
    const score = visibleTallyScore(tally, showWeightedLoveScore, loveVoteWeight);
    return {
      candidateId: candidate.id,
      name: candidate.name,
      description: candidate.description ?? undefined,
      imagePath: candidate.image_path,
      nominatorDisplayName: candidate.nominator_display_name,
      isActive: candidate.is_active,
      score,
      normalScore: showWeightedLoveScore ? tally.normal_score : score,
      loveScore: showWeightedLoveScore ? tally.love_score : 0,
      loveBaseScore: showWeightedLoveScore ? Math.round(tally.love_score / loveVoteWeight) : 0,
      loveVoteCount: showWeightedLoveScore ? tally.love_vote_count : 0,
      lastVoteAt: tally.last_vote_at,
    };
  }));
}
