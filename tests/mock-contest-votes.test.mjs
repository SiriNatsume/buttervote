import assert from "node:assert/strict";
import test from "node:test";

import {
  assertLoopbackSupabaseUrl,
  buildApprovalMatrix,
  buildTargetScores,
} from "../scripts/mock-contest-votes.mjs";

test("only loopback Supabase URLs are accepted", () => {
  assert.equal(assertLoopbackSupabaseUrl("http://127.0.0.1:54321").hostname, "127.0.0.1");
  assert.equal(assertLoopbackSupabaseUrl("http://localhost:54321").hostname, "localhost");
  assert.throws(
    () => assertLoopbackSupabaseUrl("https://project.supabase.co"),
    /Supabase/,
  );
});

test("target scores are descending, bounded, and contain deterministic ties", () => {
  const scores = buildTargetScores(48, 120);

  assert.equal(scores.length, 48);
  assert.equal(scores[0], 108);
  assert.equal(scores.at(-1), 12);
  assert.ok(scores.every((score) => score >= 1 && score <= 120));
  assert.ok(scores.every((score, index) => index === 0 || score <= scores[index - 1]));
  assert.ok(scores.some((score, index) => index > 0 && score === scores[index - 1]));
});

test("approval matrix produces the exact score for every candidate", () => {
  const candidateIds = Array.from({ length: 48 }, (_, index) => `candidate-${index + 1}`);
  const scores = buildTargetScores(candidateIds.length, 120);
  const first = buildApprovalMatrix(candidateIds, scores, 120, "fixed-seed");
  const second = buildApprovalMatrix(candidateIds, scores, 120, "fixed-seed");

  assert.deepEqual(first, second);
  assert.equal(first.length, 120);
  assert.ok(first.every((selection) => selection.length > 0));
  assert.ok(first.every((selection) => new Set(selection).size === selection.length));

  const actual = new Map(candidateIds.map((candidateId) => [candidateId, 0]));
  for (const selection of first) {
    for (const candidateId of selection) {
      actual.set(candidateId, actual.get(candidateId) + 1);
    }
  }

  assert.deepEqual(
    candidateIds.map((candidateId) => actual.get(candidateId)),
    scores,
  );
});
