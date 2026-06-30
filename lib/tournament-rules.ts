export type TournamentResult = {
  candidateId: string;
  score: number;
  lastVoteAt?: string | null;
  name?: string;
};

export type PreliminaryGroupKey = "A" | "B" | "C" | "D";

export type RankLookup =
  | ReadonlyMap<string, number>
  | Record<string, number | undefined>;

export type ScreeningBoundary<T extends TournamentResult> = {
  limit: number;
  score: number | null;
  cutoffPosition: number | null;
  isExtendedByTie: boolean;
  extraAdvancerCount: number;
  tiedCandidates: T[];
};

export type ScreeningResolution<T extends TournamentResult> = {
  ordered: T[];
  advancers: T[];
  boundary: ScreeningBoundary<T>;
};

export type PreliminaryPools<T extends TournamentResult> = {
  pool1: T[];
  pool2: T[];
  ordered: T[];
  randomizedBoundaryCandidates: T[];
  pool1Size: number;
};

export type PreliminaryGroups<T extends TournamentResult> = Record<
  PreliminaryGroupKey,
  T[]
>;

export type PreliminaryGroupResolution<T extends TournamentResult> = {
  ordered: T[];
  advancers: T[];
  lockedAdvancers: T[];
  needsTiebreaker: boolean;
  advancementTie: {
    score: number;
    remainingSlots: number;
    candidates: T[];
  } | null;
  groupFirstTie: {
    score: number;
    candidates: T[];
  } | null;
  tiebreakerCandidates: T[];
};

export type PreliminaryAdvancerIdResolution = {
  ok: boolean;
  candidateIds: string[];
};

export type TiebreakerResolution<T extends TournamentResult> = {
  ordered: T[];
  selected: T[];
  randomOrder: Record<string, number>;
  slots: number;
};

export type KnockoutSlot<T extends TournamentResult> = {
  slot: number;
  entry: T | null;
  fixedGroupWinner?: PreliminaryGroupKey;
};

export type KnockoutMatch<T extends TournamentResult> = {
  round: "round_of_16";
  slot: number;
  leftSlot: number;
  rightSlot: number;
  left: T | null;
  right: T | null;
};

export type KnockoutBracket<T extends TournamentResult> = {
  slots: KnockoutSlot<T>[];
  matches: KnockoutMatch<T>[];
};

export type KnockoutMatchContext = {
  headToHeadWinnerId?: string | null;
  screeningRankByCandidate?: RankLookup;
  seed?: string | number;
};

export type KnockoutMatchResolution<T extends TournamentResult> = {
  ordered: T[];
  winner: T | null;
  loser: T | null;
};

const PRELIMINARY_GROUPS: PreliminaryGroupKey[] = ["A", "B", "C", "D"];
const GROUP_WINNER_SLOTS: Record<PreliminaryGroupKey, number> = {
  A: 1,
  B: 5,
  C: 3,
  D: 7,
};
const ROUND_OF_16_PAIRS: Array<[number, number]> = [
  [1, 16],
  [8, 9],
  [5, 12],
  [4, 13],
  [3, 14],
  [6, 11],
  [7, 10],
  [2, 15],
];

function stableLabel(result: TournamentResult) {
  return result.name ?? result.candidateId;
}

function compareStable(a: TournamentResult, b: TournamentResult) {
  const byLabel = stableLabel(a).localeCompare(stableLabel(b), "zh-Hans");
  return byLabel !== 0 ? byLabel : a.candidateId.localeCompare(b.candidateId);
}

function compareNullableTime(a?: string | null, b?: string | null) {
  if (a && b) {
    return a.localeCompare(b);
  }

  if (a) {
    return -1;
  }

  if (b) {
    return 1;
  }

  return 0;
}

function compareScreeningOrder(a: TournamentResult, b: TournamentResult) {
  if (b.score !== a.score) {
    return b.score - a.score;
  }

  const byLastVoteAt = compareNullableTime(a.lastVoteAt, b.lastVoteAt);
  return byLastVoteAt !== 0 ? byLastVoteAt : compareStable(a, b);
}

function comparePreliminaryOrder(
  screeningRankByCandidate: RankLookup,
  a: TournamentResult,
  b: TournamentResult,
) {
  if (b.score !== a.score) {
    return b.score - a.score;
  }

  const aRank = getRank(screeningRankByCandidate, a.candidateId);
  const bRank = getRank(screeningRankByCandidate, b.candidateId);
  if (aRank !== bRank) {
    return aRank - bRank;
  }

  const byLastVoteAt = compareNullableTime(a.lastVoteAt, b.lastVoteAt);
  return byLastVoteAt !== 0 ? byLastVoteAt : compareStable(a, b);
}

function getRank(lookup: RankLookup | undefined, candidateId: string) {
  if (!lookup) {
    return Number.POSITIVE_INFINITY;
  }

  if (typeof (lookup as ReadonlyMap<string, number>).get === "function") {
    return (
      (lookup as ReadonlyMap<string, number>).get(candidateId) ??
      Number.POSITIVE_INFINITY
    );
  }

  return (
    (lookup as Record<string, number | undefined>)[candidateId] ??
    Number.POSITIVE_INFINITY
  );
}

function hashSeed(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function createRandom(seed: string | number) {
  let state = hashSeed(String(seed)) || 0x6d2b79f5;

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleWithSeed<T>(
  items: readonly T[],
  seed: string | number,
  salt: string,
) {
  const shuffled = [...items];
  const random = createRandom(`${seed}:${salt}`);

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }

  return shuffled;
}

function toRandomOrder<T extends TournamentResult>(
  items: readonly T[],
  seed: string | number,
  salt: string,
) {
  return Object.fromEntries(
    shuffleWithSeed(items, seed, salt).map((item, index) => [
      item.candidateId,
      index,
    ]),
  );
}

function uniqueByCandidate<T extends TournamentResult>(items: T[]) {
  const seen = new Set<string>();
  const unique: T[] = [];

  for (const item of items) {
    if (seen.has(item.candidateId)) {
      continue;
    }

    seen.add(item.candidateId);
    unique.push(item);
  }

  return unique;
}

function uniqueIds(items: readonly string[]) {
  return [...new Set(items.filter(Boolean))];
}

function emptyPreliminaryGroups<T extends TournamentResult>() {
  const groups: PreliminaryGroups<T> = {
    A: [],
    B: [],
    C: [],
    D: [],
  };

  return groups;
}

export function reconcilePreliminaryAdvancerIds(params: {
  advancerCandidateIds: readonly string[];
  lockedAdvancerCandidateIds?: readonly string[];
  groupWinnerCandidateId?: string | null;
  advancementOrderedCandidateIds?: readonly string[];
  slots?: number;
}): PreliminaryAdvancerIdResolution {
  const slots = params.slots ?? 4;
  const groupWinnerId = params.groupWinnerCandidateId ?? null;
  let candidateIds = uniqueIds(params.advancerCandidateIds);

  if (
    groupWinnerId &&
    !candidateIds.includes(groupWinnerId) &&
    (params.advancementOrderedCandidateIds?.length ?? 0) > 0
  ) {
    candidateIds = uniqueIds([
      ...(params.lockedAdvancerCandidateIds ?? []),
      groupWinnerId,
      ...(params.advancementOrderedCandidateIds ?? []),
    ]).slice(0, slots);
  }

  candidateIds = uniqueIds(candidateIds);

  if (
    slots <= 0 ||
    !groupWinnerId ||
    candidateIds.length !== slots ||
    !candidateIds.includes(groupWinnerId)
  ) {
    return {
      ok: false,
      candidateIds,
    };
  }

  return {
    ok: true,
    candidateIds: [
      groupWinnerId,
      ...candidateIds.filter((candidateId) => candidateId !== groupWinnerId),
    ],
  };
}

export function resolveScreeningAdvancers<T extends TournamentResult>(
  results: readonly T[],
  limit = 48,
): ScreeningResolution<T> {
  const ordered = [...results].sort(compareScreeningOrder);

  if (limit <= 0 || ordered.length === 0) {
    return {
      ordered,
      advancers: [],
      boundary: {
        limit,
        score: null,
        cutoffPosition: null,
        isExtendedByTie: false,
        extraAdvancerCount: 0,
        tiedCandidates: [],
      },
    };
  }

  if (ordered.length <= limit) {
    return {
      ordered,
      advancers: ordered,
      boundary: {
        limit,
        score: ordered.at(-1)?.score ?? null,
        cutoffPosition: ordered.length,
        isExtendedByTie: false,
        extraAdvancerCount: 0,
        tiedCandidates: [],
      },
    };
  }

  const boundaryScore = ordered[limit - 1]?.score ?? null;
  const advancers =
    boundaryScore === null
      ? []
      : ordered.filter((result) => result.score >= boundaryScore);
  const tiedCandidates =
    boundaryScore === null
      ? []
      : ordered.filter((result) => result.score === boundaryScore);

  return {
    ordered,
    advancers,
    boundary: {
      limit,
      score: boundaryScore,
      cutoffPosition: limit,
      isExtendedByTie: advancers.length > limit,
      extraAdvancerCount: Math.max(0, advancers.length - limit),
      tiedCandidates: advancers.length > limit ? tiedCandidates : [],
    },
  };
}

export function buildPreliminaryPools<T extends TournamentResult>(
  results: readonly T[],
  seed: string | number = "preliminary-pools",
  pool1Size = 8,
): PreliminaryPools<T> {
  const ordered = [...results].sort(compareScreeningOrder);

  if (pool1Size <= 0) {
    return {
      ordered,
      pool1: [],
      pool2: ordered,
      randomizedBoundaryCandidates: [],
      pool1Size,
    };
  }

  if (ordered.length <= pool1Size) {
    return {
      ordered,
      pool1: ordered,
      pool2: [],
      randomizedBoundaryCandidates: [],
      pool1Size,
    };
  }

  const boundaryScore =
    ordered[pool1Size - 1]?.score ?? Number.NEGATIVE_INFINITY;
  const fixedPool1 = ordered.filter((result) => result.score > boundaryScore);
  const boundaryCandidates = ordered.filter(
    (result) => result.score === boundaryScore,
  );
  const remainingPool1Slots = Math.max(0, pool1Size - fixedPool1.length);
  const randomizedBoundaryCandidates =
    boundaryCandidates.length > remainingPool1Slots
      ? shuffleWithSeed(boundaryCandidates, seed, "pool-1-boundary")
      : boundaryCandidates;
  const selectedBoundaryIds = new Set(
    randomizedBoundaryCandidates
      .slice(0, remainingPool1Slots)
      .map((result) => result.candidateId),
  );
  const pool1 = [
    ...fixedPool1,
    ...boundaryCandidates.filter((result) =>
      selectedBoundaryIds.has(result.candidateId),
    ),
  ];
  const pool2 = ordered.filter(
    (result) => !pool1.some((poolItem) => poolItem.candidateId === result.candidateId),
  );

  return {
    ordered,
    pool1,
    pool2,
    randomizedBoundaryCandidates:
      boundaryCandidates.length > remainingPool1Slots
        ? randomizedBoundaryCandidates
        : [],
    pool1Size,
  };
}

export function drawPreliminaryGroups<T extends TournamentResult>(
  pool1: readonly T[],
  pool2: readonly T[],
  seed: string | number = "preliminary-draw",
): PreliminaryGroups<T> {
  const groups = emptyPreliminaryGroups<T>();
  const shuffledPool1 = shuffleWithSeed(pool1, seed, "pool-1");
  const shuffledPool2 = shuffleWithSeed(pool2, seed, "pool-2");

  shuffledPool1.forEach((entry, index) => {
    const group = PRELIMINARY_GROUPS[Math.floor(index / 2) % 4];
    groups[group].push(entry);
  });

  shuffledPool2.forEach((entry, index) => {
    const group = PRELIMINARY_GROUPS[index % 4];
    groups[group].push(entry);
  });

  return groups;
}

export function resolvePreliminaryGroup<T extends TournamentResult>(
  results: readonly T[],
  screeningRankByCandidate: RankLookup,
  advancerSlots = 4,
): PreliminaryGroupResolution<T> {
  const ordered = [...results].sort((a, b) =>
    comparePreliminaryOrder(screeningRankByCandidate, a, b),
  );
  const firstScore = ordered[0]?.score;
  const groupFirstCandidates =
    firstScore === undefined
      ? []
      : ordered.filter((result) => result.score === firstScore);
  const groupFirstTie =
    groupFirstCandidates.length > 1
      ? { score: firstScore, candidates: groupFirstCandidates }
      : null;

  if (advancerSlots <= 0 || ordered.length === 0) {
    return {
      ordered,
      advancers: [],
      lockedAdvancers: [],
      needsTiebreaker: Boolean(groupFirstTie),
      advancementTie: null,
      groupFirstTie,
      tiebreakerCandidates: groupFirstTie?.candidates ?? [],
    };
  }

  if (ordered.length <= advancerSlots) {
    return {
      ordered,
      advancers: ordered,
      lockedAdvancers: ordered,
      needsTiebreaker: Boolean(groupFirstTie),
      advancementTie: null,
      groupFirstTie,
      tiebreakerCandidates: groupFirstTie?.candidates ?? [],
    };
  }

  const boundaryScore =
    ordered[advancerSlots - 1]?.score ?? Number.NEGATIVE_INFINITY;
  const boundaryCandidates = ordered.filter(
    (result) => result.score === boundaryScore,
  );
  const lockedAdvancers = ordered.filter((result) => result.score > boundaryScore);
  const boundaryStartsBeforeCutoff = lockedAdvancers.length < advancerSlots;
  const boundaryExtendsPastCutoff =
    lockedAdvancers.length + boundaryCandidates.length > advancerSlots;
  const advancementTie =
    boundaryStartsBeforeCutoff && boundaryExtendsPastCutoff
      ? {
          score: boundaryScore,
          remainingSlots: advancerSlots - lockedAdvancers.length,
          candidates: boundaryCandidates,
        }
      : null;
  const advancers = advancementTie ? lockedAdvancers : ordered.slice(0, advancerSlots);
  const tiebreakerCandidates = uniqueByCandidate([
    ...(groupFirstTie?.candidates ?? []),
    ...(advancementTie?.candidates ?? []),
  ]);

  return {
    ordered,
    advancers,
    lockedAdvancers,
    needsTiebreaker: tiebreakerCandidates.length > 0,
    advancementTie,
    groupFirstTie,
    tiebreakerCandidates,
  };
}

export function resolveTiebreaker<T extends TournamentResult>(
  results: readonly T[],
  slots: number,
  seed: string | number = "tiebreaker",
): TiebreakerResolution<T> {
  const randomOrder = toRandomOrder(results, seed, "same-score-same-time");
  const ordered = [...results].sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    const byLastVoteAt = compareNullableTime(a.lastVoteAt, b.lastVoteAt);
    if (byLastVoteAt !== 0) {
      return byLastVoteAt;
    }

    const byRandom =
      (randomOrder[a.candidateId] ?? Number.POSITIVE_INFINITY) -
      (randomOrder[b.candidateId] ?? Number.POSITIVE_INFINITY);
    return byRandom !== 0 ? byRandom : compareStable(a, b);
  });

  return {
    ordered,
    selected: ordered.slice(0, Math.max(0, slots)),
    randomOrder,
    slots,
  };
}

export function buildKnockoutBracket<
  T extends TournamentResult & {
    preliminaryGroup?: PreliminaryGroupKey | string | null;
    group?: PreliminaryGroupKey | string | null;
  },
>(
  groupWinners: Partial<Record<PreliminaryGroupKey, T>> | readonly T[],
  otherAdvancers: readonly T[],
  seed: string | number = "knockout-draw",
): KnockoutBracket<T> {
  const slots: Array<KnockoutSlot<T>> = Array.from({ length: 16 }, (_, index) => ({
    slot: index + 1,
    entry: null as T | null,
  }));
  const winnerByGroup = normalizeGroupWinners(groupWinners);
  const fixedWinnerIds = new Set<string>();

  for (const group of PRELIMINARY_GROUPS) {
    const winner = winnerByGroup[group];
    if (!winner) {
      continue;
    }

    const slot = GROUP_WINNER_SLOTS[group];
    slots[slot - 1] = {
      slot,
      entry: winner,
      fixedGroupWinner: group,
    };
    fixedWinnerIds.add(winner.candidateId);
  }

  const shuffledOthers = shuffleWithSeed(
    otherAdvancers.filter((entry) => !fixedWinnerIds.has(entry.candidateId)),
    seed,
    "other-advancers",
  );
  const emptySlots = slots.filter((slot) => !slot.entry);

  shuffledOthers.slice(0, emptySlots.length).forEach((entry, index) => {
    const target = emptySlots[index];
    slots[target.slot - 1] = { ...target, entry };
  });

  const entryBySlot = new Map(slots.map((slot) => [slot.slot, slot.entry]));
  const matches = ROUND_OF_16_PAIRS.map(([leftSlot, rightSlot], index) => ({
    round: "round_of_16" as const,
    slot: index + 1,
    leftSlot,
    rightSlot,
    left: entryBySlot.get(leftSlot) ?? null,
    right: entryBySlot.get(rightSlot) ?? null,
  }));

  return { slots, matches };
}

export function resolveKnockoutMatch<T extends TournamentResult>(
  results: readonly T[],
  context: KnockoutMatchContext = {},
): KnockoutMatchResolution<T> {
  const randomOrder = toRandomOrder(
    results,
    context.seed ?? "knockout-match-fallback",
    "fallback",
  );
  const ordered = [...results].sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    if (
      context.headToHeadWinnerId &&
      a.candidateId !== b.candidateId &&
      (a.candidateId === context.headToHeadWinnerId ||
        b.candidateId === context.headToHeadWinnerId)
    ) {
      return a.candidateId === context.headToHeadWinnerId ? -1 : 1;
    }

    const aRank = getRank(context.screeningRankByCandidate, a.candidateId);
    const bRank = getRank(context.screeningRankByCandidate, b.candidateId);
    if (aRank !== bRank) {
      return aRank - bRank;
    }

    const byLastVoteAt = compareNullableTime(a.lastVoteAt, b.lastVoteAt);
    if (byLastVoteAt !== 0) {
      return byLastVoteAt;
    }

    const byRandom =
      (randomOrder[a.candidateId] ?? Number.POSITIVE_INFINITY) -
      (randomOrder[b.candidateId] ?? Number.POSITIVE_INFINITY);
    return byRandom !== 0 ? byRandom : compareStable(a, b);
  });

  return {
    ordered,
    winner: ordered[0] ?? null,
    loser: ordered[1] ?? null,
  };
}

function normalizeGroupWinners<
  T extends TournamentResult & {
    preliminaryGroup?: PreliminaryGroupKey | string | null;
    group?: PreliminaryGroupKey | string | null;
  },
>(
  input: Partial<Record<PreliminaryGroupKey, T>> | readonly T[],
): Partial<Record<PreliminaryGroupKey, T>> {
  if (Array.isArray(input)) {
    const entries: Array<[PreliminaryGroupKey, T]> = [];

    input.forEach((winner, index) => {
      const group = normalizeGroupKey(winner.preliminaryGroup ?? winner.group);
      entries.push([
        group ?? PRELIMINARY_GROUPS[index % PRELIMINARY_GROUPS.length],
        winner,
      ]);
    });

    return Object.fromEntries(entries) as Partial<Record<PreliminaryGroupKey, T>>;
  }

  return input as Partial<Record<PreliminaryGroupKey, T>>;
}

function normalizeGroupKey(value: unknown): PreliminaryGroupKey | null {
  return PRELIMINARY_GROUPS.find((group) => group === value) ?? null;
}
