import assert from "node:assert/strict";
import {
  buildContestCallingEvents,
  normalizeContestCallingEvent,
  shouldPauseAutoCallingAtPhaseBoundary,
  withContestCallingPhaseProgress,
} from "../lib/contest-calling.ts";
import type { Candidate, Vote } from "../lib/types.ts";

assert.equal(shouldPauseAutoCallingAtPhaseBoundary("base", "love_bonus"), true);
assert.equal(shouldPauseAutoCallingAtPhaseBoundary("base", "base"), false);
assert.equal(shouldPauseAutoCallingAtPhaseBoundary("love_bonus", "love_bonus"), false);

const baseCandidate = {
  contest_id: "contest",
  nomination_id: null,
  description: null,
  image_path: null,
  image_width: null,
  image_height: null,
  image_size: null,
  nominator_display_name: null,
  nominator_note: null,
  inherited_from_candidate_id: null,
  is_active: true,
  deleted_at: null,
  created_at: "2026-07-01T00:00:00.000Z",
};

function candidate(id: string, name: string): Candidate {
  return {
    ...baseCandidate,
    id,
    name,
  };
}

function singleVote(id: string, candidateId: string, createdAt: string): Vote {
  return {
    id,
    contest_id: "contest",
    voter_id: id,
    payload: { candidateId },
    created_at: createdAt,
  };
}

{
  const events = buildContestCallingEvents({
    voteType: "single",
    candidates: [candidate("a", "Alpha"), candidate("b", "Beta")],
    votes: [
      singleVote("vote-a", "a", "2026-07-01T10:00:00.000Z"),
      singleVote("vote-b", "b", "2026-07-01T10:01:00.000Z"),
    ],
    loveAllocations: [{ vote_id: "vote-a", candidate_id: "a" }],
    loveVoteWeight: 3,
    seed: "calling-test",
  });

  assert.equal(events.length, 3);
  assert.deepEqual(
    events.map((event) => event.phase),
    ["base", "base", "love_bonus"],
  );
  assert.deepEqual(
    events.map((event) => [event.metadata.phaseStep, event.metadata.phaseTotal]),
    [
      [1, 2],
      [2, 2],
      [1, 1],
    ],
  );
  assert.equal(events[2]?.candidateId, "a");
  assert.equal(events[2]?.deltaScore, 2);
  assert.equal(
    events.at(-1)?.scores.find((score) => score.candidateId === "a")?.score,
    3,
  );
  assert.equal(
    events.at(-1)?.scores.find((score) => score.candidateId === "b")?.score,
    1,
  );
}

{
  const events = buildContestCallingEvents({
    voteType: "ranked",
    candidates: [candidate("a", "Alpha"), candidate("b", "Beta")],
    votes: [
      {
        id: "ranked-vote",
        contest_id: "contest",
        voter_id: "ranked-voter",
        payload: { ranking: ["a", "b"] },
        created_at: "2026-07-01T10:00:00.000Z",
      },
    ],
    loveAllocations: [{ vote_id: "ranked-vote", candidate_id: "a" }],
    loveVoteWeight: 4,
    seed: "ranked-calling-test",
  });

  const loveEvent = events.find((event) => event.phase === "love_bonus");
  assert.equal(loveEvent?.candidateId, "a");
  assert.equal(loveEvent?.deltaScore, 9);
  assert.equal(
    events.at(-1)?.scores.find((score) => score.candidateId === "a")?.score,
    12,
  );
}

{
  const events = buildContestCallingEvents({
    voteType: "single",
    candidates: [candidate("a", "Alpha")],
    votes: [singleVote("vote-a", "a", "2026-07-01T10:00:00.000Z")],
    loveAllocations: [{ vote_id: "vote-a", candidate_id: "a" }],
    loveVoteWeight: 1,
    seed: "no-love-bonus",
  });

  assert.equal(events.length, 1);
  assert.equal(events[0]?.phase, "base");
}

{
  const events = buildContestCallingEvents({
    voteType: "single",
    candidates: [candidate("a", "Alpha"), candidate("b", "Beta")],
    votes: [
      singleVote("vote-a-1", "a", "2026-07-01T10:00:00.000Z"),
      singleVote("vote-a-2", "a", "2026-07-01T10:01:00.000Z"),
      singleVote("vote-b", "b", "2026-07-01T10:02:00.000Z"),
    ],
    loveAllocations: [
      { vote_id: "vote-a-1", candidate_id: "a" },
      { vote_id: "vote-a-2", candidate_id: "a" },
    ],
    loveVoteWeight: 3,
    seed: "love-one-by-one",
  });
  const loveEvents = events.filter((event) => event.phase === "love_bonus");

  assert.equal(events.length, 5);
  assert.equal(loveEvents.length, 2);
  assert.deepEqual(
    loveEvents.map((event) => event.deltaScore),
    [2, 2],
  );
  assert.deepEqual(
    loveEvents.map((event) => [event.metadata.phaseStep, event.metadata.phaseTotal]),
    [
      [1, 2],
      [2, 2],
    ],
  );
  assert.equal(
    events.at(-1)?.scores.find((score) => score.candidateId === "a")?.score,
    6,
  );
}
{
  const [event] = buildContestCallingEvents({
    voteType: "single",
    candidates: [candidate("a", "Alpha")],
    votes: [singleVote("vote-a", "a", "2026-07-01T10:00:00.000Z")],
    seed: "normalize",
  });
  assert.ok(event);

  const normalized = normalizeContestCallingEvent({
    sequence: event.sequence,
    phase: event.phase,
    candidate_id: event.candidateId,
    delta_score: event.deltaScore,
    candidate_snapshot: event.candidateSnapshot,
    scores: event.scores,
    metadata: event.metadata,
  });

  assert.equal(normalized?.candidateSnapshot.name, "Alpha");
  assert.equal(normalized?.metadata.phaseStep, 1);
  assert.equal(normalized?.metadata.phaseTotal, 1);
  assert.equal(normalized?.scores[0]?.score, 1);

  const legacyEvent = normalizeContestCallingEvent({
    sequence: 3,
    phase: "love_bonus",
    candidate_id: event.candidateId,
    delta_score: event.deltaScore,
    candidate_snapshot: event.candidateSnapshot,
    scores: event.scores,
    metadata: {
      voteId: "legacy-love",
      basePoints: 1,
      loveVoteWeight: 3,
      label: "真爱票加权",
    },
  });
  const compatibleEvent = withContestCallingPhaseProgress(legacyEvent, {
    baseEventCount: 2,
    loveBonusEventCount: 4,
  });

  assert.equal(compatibleEvent?.metadata.phaseStep, 1);
  assert.equal(compatibleEvent?.metadata.phaseTotal, 4);
}

console.log("contest calling tests passed");
