import type { Candidate, LoveVoteAllocation, Vote, VoteType } from "@/lib/types";

export type TallyResult = {
  candidateId: string;
  name: string;
  description?: string;
  imagePath?: string | null;
  nominatorDisplayName?: string | null;
  isActive?: boolean;
  score: number;
  normalScore: number;
  loveScore: number;
  loveBaseScore: number;
  loveVoteCount: number;
  lastVoteAt: string | null;
  /**
   * Pure score rank. Candidates with the same score share this rank even when
   * later tie-breakers sort them apart.
   */
  rank: number;
  /**
   * One-based position after applying the full display sort.
   */
  position: number;
  /**
   * Alias for `position` for stage rules that need the fully resolved order.
   */
  resolvedRank: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function tallyVotes(params: {
  voteType: VoteType;
  candidates: Array<
    Pick<
      Candidate,
      "id" | "name" | "description" | "image_path" | "nominator_display_name" | "is_active"
    >
  >;
  votes: Vote[];
  loveVoteWeight?: number | null;
  loveVoteScoreMode?: "weighted" | "base";
  loveAllocations?: Array<Pick<LoveVoteAllocation, "vote_id" | "candidate_id">>;
}): TallyResult[] {
  const {
    voteType,
    candidates,
    votes,
    loveVoteWeight,
    loveVoteScoreMode = "weighted",
    loveAllocations = [],
  } = params;
  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  const normalScores = new Map(candidates.map((candidate) => [candidate.id, 0]));
  const loveScores = new Map(candidates.map((candidate) => [candidate.id, 0]));
  const loveBaseScores = new Map(
    candidates.map((candidate) => [candidate.id, 0]),
  );
  const loveVoteCounts = new Map(
    candidates.map((candidate) => [candidate.id, 0]),
  );
  const lastVoteAtByCandidate = new Map(
    candidates.map((candidate) => [candidate.id, null as string | null]),
  );
  const loveByVote = new Map<string, Set<string>>();
  const effectiveLoveVoteWeight =
    typeof loveVoteWeight === "number" && Number.isFinite(loveVoteWeight)
      ? loveVoteWeight
      : null;

  if (effectiveLoveVoteWeight !== null) {
    for (const allocation of loveAllocations) {
      if (!candidateIds.has(allocation.candidate_id)) {
        continue;
      }

      const current = loveByVote.get(allocation.vote_id) ?? new Set<string>();
      current.add(allocation.candidate_id);
      loveByVote.set(allocation.vote_id, current);
    }
  }

  function recordLastVoteAt(candidateId: string, votedAt: string) {
    const current = lastVoteAtByCandidate.get(candidateId);
    if (!current || votedAt > current) {
      lastVoteAtByCandidate.set(candidateId, votedAt);
    }
  }

  function addPoints(
    voteId: string,
    candidateId: string,
    points: number,
    votedAt: string,
  ) {
    const isLoveVote = loveByVote.get(voteId)?.has(candidateId) ?? false;
    recordLastVoteAt(candidateId, votedAt);

    if (isLoveVote && effectiveLoveVoteWeight !== null) {
      const lovePointMultiplier =
        loveVoteScoreMode === "base" ? 1 : effectiveLoveVoteWeight;
      loveBaseScores.set(
        candidateId,
        (loveBaseScores.get(candidateId) ?? 0) + points,
      );
      loveScores.set(
        candidateId,
        (loveScores.get(candidateId) ?? 0) + points * lovePointMultiplier,
      );
      loveVoteCounts.set(
        candidateId,
        (loveVoteCounts.get(candidateId) ?? 0) + 1,
      );
      return;
    }

    normalScores.set(candidateId, (normalScores.get(candidateId) ?? 0) + points);
  }

  for (const vote of votes) {
    if (!isRecord(vote.payload)) {
      continue;
    }

    if (voteType === "single") {
      const candidateId = vote.payload.candidateId;
      if (typeof candidateId === "string" && candidateIds.has(candidateId)) {
        addPoints(vote.id, candidateId, 1, vote.created_at);
      }
    }

    if (voteType === "multiple") {
      const candidateIdsPayload = vote.payload.candidateIds;
      if (Array.isArray(candidateIdsPayload)) {
        for (const candidateId of candidateIdsPayload) {
          if (typeof candidateId === "string" && candidateIds.has(candidateId)) {
            addPoints(vote.id, candidateId, 1, vote.created_at);
          }
        }
      }
    }

    if (voteType === "ranked") {
      const ranking = vote.payload.ranking;
      if (Array.isArray(ranking)) {
        ranking.slice(0, 3).forEach((candidateId, index) => {
          const points = [3, 2, 1][index] ?? 0;
          if (typeof candidateId === "string" && candidateIds.has(candidateId)) {
            addPoints(vote.id, candidateId, points, vote.created_at);
          }
        });
      }
    }
  }

  const ordered = candidates
    .map((candidate) => ({
      candidateId: candidate.id,
      name: candidate.name,
      description: candidate.description ?? undefined,
      imagePath: candidate.image_path,
      nominatorDisplayName: candidate.nominator_display_name,
      isActive: candidate.is_active,
      normalScore: normalScores.get(candidate.id) ?? 0,
      loveScore: loveScores.get(candidate.id) ?? 0,
      loveBaseScore: loveBaseScores.get(candidate.id) ?? 0,
      loveVoteCount: loveVoteCounts.get(candidate.id) ?? 0,
      lastVoteAt: lastVoteAtByCandidate.get(candidate.id) ?? null,
      score:
        (normalScores.get(candidate.id) ?? 0) +
        (loveScores.get(candidate.id) ?? 0),
      rank: 0,
      position: 0,
      resolvedRank: 0,
    }))
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      if (a.lastVoteAt && b.lastVoteAt) {
        return a.lastVoteAt.localeCompare(b.lastVoteAt);
      }

      if (a.lastVoteAt) {
        return -1;
      }

      if (b.lastVoteAt) {
        return 1;
      }

      return a.name.localeCompare(b.name, "zh-Hans");
    });

  let lastScore: number | null = null;
  let currentRank = 0;

  return ordered.map((item, index) => {
    if (item.score !== lastScore) {
      currentRank = index + 1;
      lastScore = item.score;
    }

    return {
      ...item,
      rank: currentRank,
      position: index + 1,
      resolvedRank: index + 1,
    };
  });
}
