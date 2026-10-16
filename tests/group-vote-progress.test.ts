import assert from "node:assert/strict";
import test from "node:test";
import {
  emptySelection,
  groupVoteContests,
  isContestSelectionComplete,
  selectedIdsForContest,
} from "../lib/group-vote-progress";

const single = { vote_type: "single" as const, max_choices: 1, require_exact_choices: false };
const multiple = { vote_type: "multiple" as const, max_choices: 2, require_exact_choices: false };
const ranked = { vote_type: "ranked" as const, max_choices: 3, require_exact_choices: false };

test("pending activities keep their order ahead of unavailable and previously voted activities", () => {
  const contests = [
    { id: "voted-first", existingVoteId: "vote-1", candidates: ["a"] },
    { id: "pending-first", existingVoteId: null, candidates: ["b"] },
    { id: "empty", candidates: [] },
    { id: "voted-without-active-candidates", existingVoteId: "vote-2", candidates: [] },
    { id: "pending-last", candidates: ["c"] },
  ];
  const originalIds = contests.map((contest) => contest.id);
  const result = groupVoteContests(contests);
  assert.deepEqual(result.pending.map((contest) => contest.id), ["pending-first", "pending-last"]);
  assert.deepEqual(result.unavailable.map((contest) => contest.id), ["empty"]);
  assert.deepEqual(result.voted.map((contest) => contest.id), ["voted-first", "voted-without-active-candidates"]);
  assert.deepEqual(contests.map((contest) => contest.id), originalIds);
});

test("already voted and empty groups have no steps to complete or resubmit", () => {
  assert.equal(groupVoteContests([{ existingVoteId: "vote", candidates: ["a"] }]).pending.length, 0);
  assert.deepEqual(groupVoteContests([]), { pending: [], unavailable: [], voted: [] });
});

test("single-choice progress starts incomplete and completes only when a candidate is chosen", () => {
  const selection = emptySelection();
  assert.equal(isContestSelectionComplete(single, selection), false);
  selection.candidateId = "a";
  assert.equal(isContestSelectionComplete(single, selection), true);
  assert.deepEqual(selectedIdsForContest(single, selection), ["a"]);
});

test("an exact-choice activity stays incomplete until the required number is chosen", () => {
  const exact = { ...multiple, require_exact_choices: true };
  const selection = { ...emptySelection(), candidateIds: ["a"] };
  assert.equal(isContestSelectionComplete(exact, selection), false);
  selection.candidateIds.push("b");
  assert.equal(isContestSelectionComplete(exact, selection), true);
  selection.candidateIds.pop();
  assert.equal(isContestSelectionComplete(exact, selection), false);
  assert.equal(isContestSelectionComplete(exact, { ...selection, candidateIds: ["a", "b", "c"] }), false);
});

test("optional multiple choice accepts one through the limit and rejects empty or duplicate choices", () => {
  assert.equal(isContestSelectionComplete(multiple, emptySelection()), false);
  for (const candidateIds of [["a"], ["a", "b"]]) {
    assert.equal(isContestSelectionComplete(multiple, { ...emptySelection(), candidateIds }), true);
  }
  for (const candidateIds of [["a", "a"], ["a", "b", "c"]]) {
    assert.equal(isContestSelectionComplete(multiple, { ...emptySelection(), candidateIds }), false);
  }
});

test("ranked review follows submitted ranking order, including partially filled rankings", () => {
  const selection = { ...emptySelection(), ranking: ["c", "", "b"] };
  assert.equal(isContestSelectionComplete(ranked, selection), true);
  assert.deepEqual(selectedIdsForContest(ranked, selection), ["c", "b"]);
  assert.equal(isContestSelectionComplete(ranked, { ...selection, ranking: ["b", "b", ""] }), false);
  assert.equal(isContestSelectionComplete(ranked, emptySelection()), false);
});

test("ordinary and love-vote selections use the same completion rules", () => {
  const selection = { ...emptySelection(), candidateId: "a" };
  assert.equal(isContestSelectionComplete(single, selection), true);
  assert.equal(isContestSelectionComplete(single, { ...selection, loveCandidateIds: ["a"] }), true);
  assert.equal(isContestSelectionComplete(single, { ...emptySelection(), loveCandidateIds: ["a"] }), false);
});
