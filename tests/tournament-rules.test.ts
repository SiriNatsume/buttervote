import assert from "node:assert/strict";
import {
  buildKnockoutBracket,
  buildPreliminaryPools,
  drawPreliminaryGroups,
  reconcilePreliminaryAdvancerIds,
  resolveKnockoutMatch,
  resolvePreliminaryGroup,
  resolveScreeningAdvancers,
  resolveTiebreaker,
  type TournamentResult,
} from "../lib/tournament-rules.ts";

function result(
  candidateId: string,
  score: number,
  lastVoteAt: string | null = null,
): TournamentResult {
  return {
    candidateId,
    name: candidateId.toUpperCase(),
    score,
    lastVoteAt,
  };
}

function groupWinner(candidateId: string, group: "A" | "B" | "C" | "D") {
  return {
    ...result(candidateId, 10),
    preliminaryGroup: group,
  };
}

{
  const resolution = resolveScreeningAdvancers(
    [
      result("a", 10),
      result("b", 9),
      result("c", 8, "2026-06-01T08:00:00.000Z"),
      result("d", 8, "2026-06-01T09:00:00.000Z"),
      result("e", 7),
    ],
    3,
  );

  assert.equal(resolution.advancers.length, 4);
  assert.equal(resolution.boundary.isExtendedByTie, true);
  assert.equal(resolution.boundary.extraAdvancerCount, 1);
  assert.deepEqual(
    resolution.advancers.map((item) => item.candidateId),
    ["a", "b", "c", "d"],
  );
}

{
  const tiedBoundary = [
    ...Array.from({ length: 6 }, (_, index) => result(`fixed-${index}`, 10)),
    ...Array.from({ length: 4 }, (_, index) => result(`tie-${index}`, 9)),
  ];
  const pools = buildPreliminaryPools(tiedBoundary, "pool-seed", 8);
  const repeat = buildPreliminaryPools(tiedBoundary, "pool-seed", 8);

  assert.equal(pools.pool1.length, 8);
  assert.equal(pools.pool2.length, 2);
  assert.equal(
    pools.pool1.filter((item) => item.candidateId.startsWith("tie-")).length,
    2,
  );
  assert.deepEqual(
    pools.pool1.map((item) => item.candidateId),
    repeat.pool1.map((item) => item.candidateId),
  );
  assert.equal(pools.randomizedBoundaryCandidates.length, 4);
}

{
  const pool1 = Array.from({ length: 8 }, (_, index) => result(`p1-${index}`, 10));
  const pool2 = Array.from({ length: 40 }, (_, index) => result(`p2-${index}`, 1));
  const groups = drawPreliminaryGroups(pool1, pool2, "draw-seed");

  assert.deepEqual(
    Object.values(groups).map((items) => items.length),
    [12, 12, 12, 12],
  );
  assert.deepEqual(
    Object.values(groups).map(
      (items) => items.filter((item) => item.candidateId.startsWith("p1-")).length,
    ),
    [2, 2, 2, 2],
  );
}

{
  const resolution = resolvePreliminaryGroup(
    [
      result("a", 10),
      result("b", 8),
      result("c", 7),
      result("d", 5),
      result("e", 5),
    ],
    { a: 1, b: 2, c: 3, d: 4, e: 5 },
  );

  assert.equal(resolution.needsTiebreaker, true);
  assert.equal(resolution.advancementTie?.remainingSlots, 1);
  assert.deepEqual(
    resolution.lockedAdvancers.map((item) => item.candidateId),
    ["a", "b", "c"],
  );
  assert.deepEqual(
    resolution.advancementTie?.candidates.map((item) => item.candidateId),
    ["d", "e"],
  );
}

{
  const resolution = resolvePreliminaryGroup(
    [result("a", 10), result("b", 10), result("c", 5), result("d", 4)],
    { a: 1, b: 2, c: 3, d: 4 },
  );

  assert.equal(resolution.needsTiebreaker, true);
  assert.deepEqual(
    resolution.groupFirstTie?.candidates.map((item) => item.candidateId),
    ["a", "b"],
  );
}

{
  const first = resolveTiebreaker(
    [
      result("a", 1, "2026-06-01T10:00:00.000Z"),
      result("b", 1, "2026-06-01T10:00:00.000Z"),
    ],
    1,
    "fallback-seed",
  );
  const repeat = resolveTiebreaker(
    [
      result("a", 1, "2026-06-01T10:00:00.000Z"),
      result("b", 1, "2026-06-01T10:00:00.000Z"),
    ],
    1,
    "fallback-seed",
  );

  assert.equal(first.selected.length, 1);
  assert.equal(first.selected[0]?.candidateId, repeat.selected[0]?.candidateId);
}

{
  const resolution = reconcilePreliminaryAdvancerIds({
    advancerCandidateIds: ["a", "b", "c", "d"],
    groupWinnerCandidateId: "e",
    advancementOrderedCandidateIds: ["a", "b", "c", "d", "e"],
  });

  assert.equal(resolution.ok, true);
  assert.deepEqual(resolution.candidateIds, ["e", "a", "b", "c"]);
}

{
  const resolution = reconcilePreliminaryAdvancerIds({
    advancerCandidateIds: ["a", "b", "c", "d"],
    groupWinnerCandidateId: "missing",
  });

  assert.equal(resolution.ok, false);
}

{
  const bracket = buildKnockoutBracket(
    {
      A: groupWinner("a1", "A"),
      B: groupWinner("b1", "B"),
      C: groupWinner("c1", "C"),
      D: groupWinner("d1", "D"),
    },
    Array.from({ length: 12 }, (_, index) => result(`other-${index}`, 1)),
    "bracket-seed",
  );

  assert.equal(bracket.slots[0]?.entry?.candidateId, "a1");
  assert.equal(bracket.slots[4]?.entry?.candidateId, "b1");
  assert.equal(bracket.slots[2]?.entry?.candidateId, "c1");
  assert.equal(bracket.slots[6]?.entry?.candidateId, "d1");
  assert.equal(bracket.matches.length, 8);

  const fixedGroupWinnerIds = new Set(["a1", "b1", "c1", "d1"]);
  const groupWinnerIdsByMatch = bracket.matches.map((match) => ({
    slot: match.slot,
    winners: [match.left, match.right]
      .filter((entry) => entry && fixedGroupWinnerIds.has(entry.candidateId))
      .map((entry) => entry?.candidateId),
  }));

  assert.deepEqual(groupWinnerIdsByMatch, [
    { slot: 1, winners: ["a1"] },
    { slot: 2, winners: [] },
    { slot: 3, winners: ["b1"] },
    { slot: 4, winners: [] },
    { slot: 5, winners: ["c1"] },
    { slot: 6, winners: [] },
    { slot: 7, winners: ["d1"] },
    { slot: 8, winners: [] },
  ]);

  assert.deepEqual(
    bracket.matches
      .filter((match) => [1, 2, 3, 4].includes(match.slot))
      .flatMap((match) => [match.left, match.right])
      .filter((entry) => entry && fixedGroupWinnerIds.has(entry.candidateId))
      .map((entry) => entry?.candidateId),
    ["a1", "b1"],
  );
  assert.deepEqual(
    bracket.matches
      .filter((match) => [5, 6, 7, 8].includes(match.slot))
      .flatMap((match) => [match.left, match.right])
      .filter((entry) => entry && fixedGroupWinnerIds.has(entry.candidateId))
      .map((entry) => entry?.candidateId),
    ["c1", "d1"],
  );

  const winnerIdsByRoundOf16 = new Map(
    groupWinnerIdsByMatch.map((match) => [match.slot, match.winners]),
  );
  const quarterfinalSources = [
    { slot: 1, sourceSlots: [1, 2] },
    { slot: 2, sourceSlots: [3, 4] },
    { slot: 3, sourceSlots: [5, 6] },
    { slot: 4, sourceSlots: [7, 8] },
  ].map((target) => ({
    slot: target.slot,
    winners: target.sourceSlots.flatMap(
      (slot) => winnerIdsByRoundOf16.get(slot) ?? [],
    ),
  }));

  assert.deepEqual(quarterfinalSources, [
    { slot: 1, winners: ["a1"] },
    { slot: 2, winners: ["b1"] },
    { slot: 3, winners: ["c1"] },
    { slot: 4, winners: ["d1"] },
  ]);

  const winnerIdsByQuarterfinal = new Map(
    quarterfinalSources.map((match) => [match.slot, match.winners]),
  );
  const semifinalSources = [
    { slot: 1, sourceSlots: [1, 2] },
    { slot: 2, sourceSlots: [3, 4] },
  ].map((target) => ({
    slot: target.slot,
    winners: target.sourceSlots.flatMap(
      (slot) => winnerIdsByQuarterfinal.get(slot) ?? [],
    ),
  }));

  assert.deepEqual(semifinalSources, [
    { slot: 1, winners: ["a1", "b1"] },
    { slot: 2, winners: ["c1", "d1"] },
  ]);
  assert.deepEqual(
    semifinalSources.flatMap((match) => match.winners),
    ["a1", "b1", "c1", "d1"],
  );

  const winnerIdsBySemifinal = new Map(
    semifinalSources.map((match) => [match.slot, match.winners]),
  );
  const terminalSources = [
    { round: "final", slot: 1, sourceSlots: [1, 2] },
    { round: "third_place", slot: 1, sourceSlots: [1, 2] },
  ].map((target) => ({
    round: target.round,
    slot: target.slot,
    winners: target.sourceSlots.flatMap(
      (slot) => winnerIdsBySemifinal.get(slot) ?? [],
    ),
  }));

  assert.deepEqual(terminalSources, [
    { round: "final", slot: 1, winners: ["a1", "b1", "c1", "d1"] },
    { round: "third_place", slot: 1, winners: ["a1", "b1", "c1", "d1"] },
  ]);
}

{
  const resolution = resolveKnockoutMatch(
    [result("same-group-loser", 3), result("same-group-winner", 3)],
    {
      headToHeadWinnerId: "same-group-winner",
      screeningRankByCandidate: {
        "same-group-loser": 1,
        "same-group-winner": 20,
      },
    },
  );

  assert.equal(resolution.winner?.candidateId, "same-group-winner");
}

console.log("tournament rule tests passed");
