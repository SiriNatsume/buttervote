import assert from "node:assert/strict";
import test from "node:test";

import {
  assertLoopbackSupabaseUrl,
  buildBoundedApprovalMatrix,
  buildStrictDescendingScores,
  nextRoundPlan,
} from "../scripts/simulate-tournament.mjs";

test("tournament simulator is restricted to loopback Supabase", () => {
  assert.equal(assertLoopbackSupabaseUrl("http://127.0.0.1:54321").hostname, "127.0.0.1");
  assert.throws(() => assertLoopbackSupabaseUrl("https://example.supabase.co"), /non-local/);
});

test("preliminary score plan is strict and fits 64 voters with four choices", () => {
  const scores = buildStrictDescendingScores(12, 64, 4);
  assert.deepEqual(scores, [26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15]);
  assert.ok(scores.reduce((sum, score) => sum + score, 0) <= 64 * 4);
});

test("bounded approval matrix exactly realizes every score", () => {
  const candidates = Array.from({ length: 12 }, (_, index) => `candidate-${index + 1}`);
  const scores = buildStrictDescendingScores(candidates.length, 64, 4);
  const matrix = buildBoundedApprovalMatrix(candidates, scores, 64, 4, "test-seed");
  assert.equal(matrix.length, 64);
  assert.ok(matrix.every((selection) => selection.length >= 1 && selection.length <= 4));
  assert.ok(matrix.every((selection) => new Set(selection).size === selection.length));

  const totals = new Map(candidates.map((candidate) => [candidate, 0]));
  for (const selection of matrix) {
    for (const candidate of selection) totals.set(candidate, totals.get(candidate) + 1);
  }
  assert.deepEqual(candidates.map((candidate) => totals.get(candidate)), scores);
});

test("round progression creates quarters, semifinals, final, and third place", () => {
  assert.deepEqual(
    nextRoundPlan("round_of_16").targets.map((target) => target.sourceSlots),
    [[1, 2], [3, 4], [5, 6], [7, 8]],
  );
  assert.deepEqual(
    nextRoundPlan("quarterfinal").targets.map((target) => target.sourceSlots),
    [[1, 2], [3, 4]],
  );
  assert.deepEqual(
    nextRoundPlan("semifinal").targets.map((target) => [target.round, target.participant]),
    [["final", "winner"], ["third_place", "loser"]],
  );
});
