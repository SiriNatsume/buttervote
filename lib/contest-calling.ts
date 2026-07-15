import type {
  Candidate,
  ContestCallingEvent,
  ContestCallingPhase,
  Json,
  LoveVoteAllocation,
  Vote,
  VoteType,
} from "@/lib/types";

export type ContestCallingCandidate = Pick<
  Candidate,
  | "id"
  | "name"
  | "description"
  | "image_path"
  | "nominator_display_name"
  | "is_active"
>;

export type ContestCallingScoreSnapshot = {
  candidateId: string;
  name: string;
  imagePath: string | null;
  score: number;
  position: number;
  isCurrent: boolean;
};

export type ContestCallingCandidateSnapshot = {
  candidateId: string;
  name: string;
  description: string | null;
  imagePath: string | null;
  nominatorDisplayName: string | null;
};

export type ContestCallingEventMetadata = {
  voteId: string;
  basePoints: number;
  loveVoteWeight: number | null;
  phaseStep: number | null;
  phaseTotal: number | null;
  label: string;
};

export type ContestCallingEventPayload = {
  sequence: number;
  phase: ContestCallingPhase;
  candidateId: string;
  deltaScore: number;
  candidateSnapshot: ContestCallingCandidateSnapshot;
  scores: ContestCallingScoreSnapshot[];
  metadata: ContestCallingEventMetadata;
};

type VotePoint = {
  voteId: string;
  candidateId: string;
  points: number;
  createdAt: string;
};

type PendingCallingEvent = {
  phase: ContestCallingPhase;
  candidateId: string;
  deltaScore: number;
  basePoints: number;
  voteId: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function shouldPauseAutoCallingAtPhaseBoundary(
  currentPhase: ContestCallingPhase | null | undefined,
  nextPhase: ContestCallingPhase | null | undefined,
  isAutoAdvance = true,
) {
  return isAutoAdvance && currentPhase === "base" && nextPhase === "love_bonus";
}

export type ContestCallingPhaseProgress = {
  phase: ContestCallingPhase;
  phaseStep: number;
  phaseTotal: number;
};

export type ContestCallingPhaseCounts = {
  baseEventCount: number;
  loveBonusEventCount: number;
};

function hashSeed(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number) {
  return function next() {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleWithSeed<T>(items: T[], seed: string) {
  const shuffled = [...items];
  const random = mulberry32(hashSeed(seed));
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function compareVotePoints(a: VotePoint, b: VotePoint) {
  const createdAtOrder = a.createdAt.localeCompare(b.createdAt);
  if (createdAtOrder !== 0) {
    return createdAtOrder;
  }
  const voteIdOrder = a.voteId.localeCompare(b.voteId);
  if (voteIdOrder !== 0) {
    return voteIdOrder;
  }
  return a.candidateId.localeCompare(b.candidateId);
}

function extractVotePoints(voteType: VoteType, vote: Vote, candidateIds: Set<string>) {
  const points: VotePoint[] = [];

  if (!isRecord(vote.payload)) {
    return points;
  }

  if (voteType === "single") {
    const candidateId = vote.payload.candidateId;
    if (typeof candidateId === "string" && candidateIds.has(candidateId)) {
      points.push({
        voteId: vote.id,
        candidateId,
        points: 1,
        createdAt: vote.created_at,
      });
    }
  }

  if (voteType === "multiple") {
    const candidateIdsPayload = vote.payload.candidateIds;
    if (Array.isArray(candidateIdsPayload)) {
      for (const candidateId of candidateIdsPayload) {
        if (typeof candidateId === "string" && candidateIds.has(candidateId)) {
          points.push({
            voteId: vote.id,
            candidateId,
            points: 1,
            createdAt: vote.created_at,
          });
        }
      }
    }
  }

  if (voteType === "ranked") {
    const ranking = vote.payload.ranking;
    if (Array.isArray(ranking)) {
      ranking.slice(0, 3).forEach((candidateId, index) => {
        const score = [3, 2, 1][index] ?? 0;
        if (typeof candidateId === "string" && candidateIds.has(candidateId)) {
          points.push({
            voteId: vote.id,
            candidateId,
            points: score,
            createdAt: vote.created_at,
          });
        }
      });
    }
  }

  return points;
}

function buildCandidateSnapshot(candidate: ContestCallingCandidate) {
  return {
    candidateId: candidate.id,
    name: candidate.name,
    description: candidate.description ?? null,
    imagePath: candidate.image_path ?? null,
    nominatorDisplayName: candidate.nominator_display_name ?? null,
  } satisfies ContestCallingCandidateSnapshot;
}

function buildScores(
  candidates: ContestCallingCandidate[],
  scores: Map<string, number>,
  currentCandidateId: string,
) {
  return candidates
    .map((candidate) => ({
      candidateId: candidate.id,
      name: candidate.name,
      imagePath: candidate.image_path ?? null,
      score: scores.get(candidate.id) ?? 0,
      position: 0,
      isCurrent: candidate.id === currentCandidateId,
    }))
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.name.localeCompare(b.name, "zh-Hans");
    })
    .map((score, index) => ({ ...score, position: index + 1 }));
}

export function buildContestCallingEvents(params: {
  voteType: VoteType;
  candidates: ContestCallingCandidate[];
  votes: Vote[];
  loveAllocations?: Array<Pick<LoveVoteAllocation, "vote_id" | "candidate_id">>;
  loveVoteWeight?: number | null;
  seed: string;
}): ContestCallingEventPayload[] {
  const activeCandidates = params.candidates.filter(
    (candidate) => candidate.is_active !== false,
  );
  const candidateIds = new Set(activeCandidates.map((candidate) => candidate.id));
  const candidateById = new Map(
    activeCandidates.map((candidate) => [candidate.id, candidate]),
  );
  const basePoints = params.votes
    .flatMap((vote) => extractVotePoints(params.voteType, vote, candidateIds))
    .sort(compareVotePoints);
  const basePointByVoteAndCandidate = new Map(
    basePoints.map((point) => [`${point.voteId}:${point.candidateId}`, point]),
  );
  const effectiveLoveVoteWeight =
    typeof params.loveVoteWeight === "number" && Number.isFinite(params.loveVoteWeight)
      ? Math.max(1, params.loveVoteWeight)
      : null;
  const loveBonusPoints =
    effectiveLoveVoteWeight && effectiveLoveVoteWeight > 1
      ? (params.loveAllocations ?? [])
          .map((allocation) =>
            basePointByVoteAndCandidate.get(
              `${allocation.vote_id}:${allocation.candidate_id}`,
            ),
          )
          .filter((point): point is VotePoint => Boolean(point))
          .sort(compareVotePoints)
          .map((point) => ({
            phase: "love_bonus" as const,
            candidateId: point.candidateId,
            deltaScore: point.points * (effectiveLoveVoteWeight - 1),
            basePoints: point.points,
            voteId: point.voteId,
          }))
      : [];
  const pendingEvents: PendingCallingEvent[] = [
    ...shuffleWithSeed(
      basePoints.map((point) => ({
        phase: "base" as const,
        candidateId: point.candidateId,
        deltaScore: point.points,
        basePoints: point.points,
        voteId: point.voteId,
      })),
      `${params.seed}:base`,
    ),
    ...shuffleWithSeed(loveBonusPoints, `${params.seed}:love_bonus`),
  ];
  const phaseTotals = pendingEvents.reduce(
    (totals, event) => {
      totals[event.phase] += 1;
      return totals;
    },
    { base: 0, love_bonus: 0 } satisfies Record<ContestCallingPhase, number>,
  );
  const phaseSteps = { base: 0, love_bonus: 0 } satisfies Record<
    ContestCallingPhase,
    number
  >;
  const scores = new Map(activeCandidates.map((candidate) => [candidate.id, 0]));

  return pendingEvents.flatMap((event, index) => {
    const candidate = candidateById.get(event.candidateId);
    if (!candidate) {
      return [];
    }
    const phaseStep = (phaseSteps[event.phase] += 1);

    scores.set(event.candidateId, (scores.get(event.candidateId) ?? 0) + event.deltaScore);

    return [
      {
        sequence: index + 1,
        phase: event.phase,
        candidateId: event.candidateId,
        deltaScore: event.deltaScore,
        candidateSnapshot: buildCandidateSnapshot(candidate),
        scores: buildScores(activeCandidates, scores, event.candidateId),
        metadata: {
          voteId: event.voteId,
          basePoints: event.basePoints,
          loveVoteWeight: effectiveLoveVoteWeight,
          phaseStep,
          phaseTotal: phaseTotals[event.phase],
          label: event.phase === "base" ? "实时总分" : "真爱票加权",
        },
      },
    ];
  });
}

function readMetadataNumber(metadata: unknown, key: string) {
  if (!isRecord(metadata)) {
    return null;
  }
  const value = metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function getContestCallingPhaseCounts(
  sessionMetadata: Json | null | undefined,
): ContestCallingPhaseCounts {
  return {
    baseEventCount: Math.max(
      0,
      Math.trunc(readMetadataNumber(sessionMetadata, "baseEventCount") ?? 0),
    ),
    loveBonusEventCount: Math.max(
      0,
      Math.trunc(
        readMetadataNumber(sessionMetadata, "loveBonusEventCount") ?? 0,
      ),
    ),
  };
}

export function advanceContestCallingStep(
  currentStep: number,
  totalSteps: number,
  count: number,
) {
  const safeCurrentStep = Math.max(0, Math.trunc(currentStep) || 0);
  const safeTotalSteps = Math.max(0, Math.trunc(totalSteps) || 0);
  const safeCount = Math.max(1, Math.trunc(count) || 1);

  return Math.min(safeTotalSteps, safeCurrentStep + safeCount);
}

export function getContestCallingLoveStartStep(
  sessionMetadata: Json | null | undefined,
) {
  const { baseEventCount, loveBonusEventCount } =
    getContestCallingPhaseCounts(sessionMetadata);

  return baseEventCount > 0 && loveBonusEventCount > 0
    ? baseEventCount
    : null;
}

export function getContestCallingPhaseProgress(
  sessionMetadata: Json | null | undefined,
  currentStep: number,
): ContestCallingPhaseProgress | null {
  if (!Number.isFinite(currentStep) || currentStep <= 0) {
    return null;
  }

  const { baseEventCount, loveBonusEventCount } =
    getContestCallingPhaseCounts(sessionMetadata);

  if (baseEventCount && currentStep <= baseEventCount) {
    return {
      phase: "base",
      phaseStep: currentStep,
      phaseTotal: baseEventCount,
    };
  }

  if (
    baseEventCount &&
    loveBonusEventCount &&
    currentStep <= baseEventCount + loveBonusEventCount
  ) {
    return {
      phase: "love_bonus",
      phaseStep: currentStep - baseEventCount,
      phaseTotal: loveBonusEventCount,
    };
  }

  return null;
}

export function withContestCallingPhaseProgress(
  event: ContestCallingEventPayload | null,
  sessionMetadata: Json | null | undefined,
): ContestCallingEventPayload | null {
  if (!event) {
    return null;
  }
  if (
    typeof event.metadata.phaseStep === "number" &&
    event.metadata.phaseStep > 0 &&
    typeof event.metadata.phaseTotal === "number" &&
    event.metadata.phaseTotal > 0
  ) {
    return event;
  }

  const phaseProgress = getContestCallingPhaseProgress(sessionMetadata, event.sequence);

  if (!phaseProgress || phaseProgress.phase !== event.phase) {
    return event;
  }

  return {
    ...event,
    metadata: {
      ...event.metadata,
      phaseStep: phaseProgress.phaseStep,
      phaseTotal: phaseProgress.phaseTotal,
    },
  };
}

export function normalizeContestCallingEvent(
  row: Pick<
    ContestCallingEvent,
    | "sequence"
    | "phase"
    | "candidate_id"
    | "delta_score"
    | "candidate_snapshot"
    | "scores"
    | "metadata"
  >,
): ContestCallingEventPayload | null {
  if (row.phase !== "base" && row.phase !== "love_bonus") {
    return null;
  }
  if (typeof row.candidate_id !== "string") {
    return null;
  }
  if (!isRecord(row.candidate_snapshot) || !Array.isArray(row.scores)) {
    return null;
  }

  const candidateSnapshot = row.candidate_snapshot;
  const scores = row.scores
    .map((score): ContestCallingScoreSnapshot | null => {
      if (!isRecord(score)) {
        return null;
      }
      if (
        typeof score.candidateId !== "string" ||
        typeof score.name !== "string" ||
        typeof score.score !== "number" ||
        typeof score.position !== "number" ||
        typeof score.isCurrent !== "boolean"
      ) {
        return null;
      }
      return {
        candidateId: score.candidateId,
        name: score.name,
        imagePath: typeof score.imagePath === "string" ? score.imagePath : null,
        score: score.score,
        position: score.position,
        isCurrent: score.isCurrent,
      };
    })
    .filter((score): score is ContestCallingScoreSnapshot => Boolean(score));
  const metadata = isRecord(row.metadata) ? row.metadata : {};

  return {
    sequence: row.sequence,
    phase: row.phase,
    candidateId: row.candidate_id,
    deltaScore: Number(row.delta_score),
    candidateSnapshot: {
      candidateId:
        typeof candidateSnapshot.candidateId === "string"
          ? candidateSnapshot.candidateId
          : row.candidate_id,
      name: typeof candidateSnapshot.name === "string" ? candidateSnapshot.name : "候选项",
      description:
        typeof candidateSnapshot.description === "string"
          ? candidateSnapshot.description
          : null,
      imagePath:
        typeof candidateSnapshot.imagePath === "string"
          ? candidateSnapshot.imagePath
          : null,
      nominatorDisplayName:
        typeof candidateSnapshot.nominatorDisplayName === "string"
          ? candidateSnapshot.nominatorDisplayName
          : null,
    },
    scores,
    metadata: {
      voteId: typeof metadata.voteId === "string" ? metadata.voteId : "",
      basePoints: typeof metadata.basePoints === "number" ? metadata.basePoints : 0,
      loveVoteWeight:
        typeof metadata.loveVoteWeight === "number" ? metadata.loveVoteWeight : null,
      phaseStep: typeof metadata.phaseStep === "number" ? metadata.phaseStep : null,
      phaseTotal: typeof metadata.phaseTotal === "number" ? metadata.phaseTotal : null,
      label: typeof metadata.label === "string" ? metadata.label : "唱票",
    },
  };
}

export function contestCallingEventToInsert(
  sessionId: string,
  contestId: string,
  event: ContestCallingEventPayload,
) {
  return {
    session_id: sessionId,
    contest_id: contestId,
    sequence: event.sequence,
    phase: event.phase,
    candidate_id: event.candidateId,
    delta_score: event.deltaScore,
    candidate_snapshot: event.candidateSnapshot as unknown as Json,
    scores: event.scores as unknown as Json,
    metadata: event.metadata as unknown as Json,
  };
}
