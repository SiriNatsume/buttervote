import assert from "node:assert/strict";
import test from "node:test";
import { BOTH_SUPPORT_CHOICE, bothSupportCandidateIds, canUseBothSupport, validateBothSupportVote } from "../lib/both-support";
import { tallyVotes } from "../lib/tally";
import { buildContestCallingEvents } from "../lib/contest-calling";
import { selectedCandidateIdsFromVotePayload } from "../lib/vote-payload";
import { emptySelection, isContestSelectionComplete, selectedIdsForContest } from "../lib/group-vote-progress";
import type { Vote } from "../lib/types";

const pair = { ballotType: "both_support", candidateIds: ["a", "b"] };
const candidates = ["a", "b"].map((id) => ({ id, name: id, description: null,
  image_path: null, nominator_display_name: null, is_active: true }));
const single = { vote_type: "single" as const, max_choices: 1, require_exact_choices: false, candidates };
const votes: Vote[] = [
  { id: "normal", contest_id: "c", voter_id: "1", payload: { candidateId: "a" }, created_at: "2026-11-01T10:00:00Z" },
  { id: "love", contest_id: "c", voter_id: "2", payload: { candidateId: "b" }, created_at: "2026-11-01T09:00:00Z" },
  { id: "both", contest_id: "c", voter_id: "3", payload: pair, created_at: "2026-11-01T12:00:00Z" },
];

test("only enabled two-candidate single-choice contests accept both support", () => {
  assert(canUseBothSupport(single, 2));
  for (const count of [0, 1, 3]) assert(!canUseBothSupport(single, count));
  for (const vote_type of ["multiple", "ranked"] as const) assert(!canUseBothSupport({ vote_type }, 2));
  assert(!canUseBothSupport({ ...single, both_support_enabled: false }, 2));
  const ids = new Set(["a", "b"]);
  assert.equal(validateBothSupportVote(single, ids, pair), null);
  assert(validateBothSupportVote(single, ids, pair, ["a"]));
  assert(validateBothSupportVote(single, new Set(["a", "c"]), pair));
  assert(validateBothSupportVote({ ...single, both_support_enabled: false }, ids, pair));
});

test("both-support payloads record exactly two distinct choices and reject mixed ballot shapes", () => {
  assert.deepEqual(bothSupportCandidateIds(pair), ["a", "b"]);
  for (const invalid of [
    { ...pair, candidateIds: ["a", "a"] }, { ...pair, candidateIds: ["a"] },
    { ...pair, candidateIds: ["a", "b", "c"] }, { ...pair, candidateId: "a" },
    { ...pair, ranking: ["a"] }, { ...pair, candidateIds: ["a", null] },
  ]) assert.deepEqual(bothSupportCandidateIds(invalid), []);
  assert.deepEqual(selectedCandidateIdsFromVotePayload("single", pair), ["a", "b"]);
  assert.deepEqual(selectedCandidateIdsFromVotePayload("multiple", pair), []);
});

test("both support adds two base points without love weighting or changing vote times", () => {
  const results = tallyVotes({ voteType: "single", candidates, votes, loveVoteWeight: 3,
    loveAllocations: [{ vote_id: "love", candidate_id: "b" }, { vote_id: "both", candidate_id: "a" }] });
  const a = results.find((item) => item.candidateId === "a")!;
  const b = results.find((item) => item.candidateId === "b")!;
  assert.deepEqual([a.score, a.normalScore, a.loveScore, a.loveVoteCount], [2, 2, 0, 0]);
  assert.deepEqual([b.score, b.normalScore, b.loveScore, b.loveVoteCount], [4, 1, 3, 1]);
  assert.equal(a.lastVoteAt, votes[0].created_at);
  assert.equal(b.lastVoteAt, votes[1].created_at);
  const onlyBoth = tallyVotes({ voteType: "single", candidates, votes: [votes[2]] });
  assert(onlyBoth.every((result) => result.score === 1 && result.lastVoteAt === null));
});

test("a late both-support ballot preserves same-score ordering and the historical pair", () => {
  const before = tallyVotes({ voteType: "single", candidates, votes: votes.slice(0, 2) });
  const after = tallyVotes({ voteType: "single", candidates, votes });
  assert.deepEqual(after.map((item) => item.candidateId), before.map((item) => item.candidateId));
  const extra = { ...candidates[0], id: "c", name: "c" };
  const changed = tallyVotes({ voteType: "single", candidates: [...candidates, extra], votes: [votes[2]] });
  assert.equal(changed.find((item) => item.candidateId === "c")?.score, 0);
});

test("group completion and review recognize both support but never reserve love quota", () => {
  const selection = { ...emptySelection(), candidateId: BOTH_SUPPORT_CHOICE };
  assert(isContestSelectionComplete(single, selection));
  assert.deepEqual(selectedIdsForContest(single, selection), ["a", "b"]);
  assert(!isContestSelectionComplete({ ...single, both_support_enabled: false }, selection));
  assert(!isContestSelectionComplete({ ...single, candidates: candidates.slice(0, 1) }, selection));
  assert(!isContestSelectionComplete(single, { ...selection, loveCandidateIds: ["a"] }));
});

test("calling reaches the same scores and never creates a love bonus for both support", () => {
  const loveAllocations = [{ vote_id: "love", candidate_id: "b" }, { vote_id: "both", candidate_id: "a" }];
  const events = buildContestCallingEvents({ voteType: "single", candidates, votes,
    loveAllocations, loveVoteWeight: 3, seed: "both-support" });
  assert.equal(events.filter((event) => event.phase === "base").length, 4);
  assert.equal(events.filter((event) => event.phase === "love_bonus").length, 1);
  const totals = new Map(events.at(-1)!.scores.map((score) => [score.candidateId, score.score]));
  for (const result of tallyVotes({ voteType: "single", candidates, votes, loveAllocations, loveVoteWeight: 3 })) {
    assert.equal(totals.get(result.candidateId), result.score);
  }
});
