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
  assert.equal(bracket.slots[8]?.entry?.candidateId, "c1");
  assert.equal(bracket.slots[12]?.entry?.candidateId, "d1");
  assert.equal(bracket.matches.length, 8);
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
