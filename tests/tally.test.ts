import assert from "node:assert/strict";
import { tallyVotes } from "../lib/tally.ts";

const baseCandidate = {
  description: null,
  image_path: null,
  nominator_display_name: null,
  is_active: true,
};

function candidate(id: string, name: string) {
  return {
    ...baseCandidate,
    id,
    name,
  };
}

function vote(id: string, candidateId: string, createdAt: string) {
  return {
    id,
    contest_id: "contest",
    voter_id: id,
    payload: { candidateId },
    created_at: createdAt,
  };
}

{
  const results = tallyVotes({
    voteType: "single",
    candidates: [candidate("a", "Alpha"), candidate("b", "Beta")],
    votes: [
      vote("vote-a", "a", "2026-06-01T10:00:00.000Z"),
      vote("vote-b", "b", "2026-06-01T09:00:00.000Z"),
    ],
  });

  assert.deepEqual(
    results.map((result) => result.candidateId),
    ["b", "a"],
  );
  assert.deepEqual(
    results.map((result) => result.rank),
    [1, 1],
  );
  assert.deepEqual(
    results.map((result) => result.position),
    [1, 2],
  );
}

{
  const candidates = [candidate("b", "2 Beta"), candidate("a", "1 Alpha")];
  const results = tallyVotes({
    voteType: "single",
    candidates,
    votes: [],
  });
  assert.deepEqual(
    new Set(results.map((result) => result.candidateId)),
    new Set(["a", "b"]),
  );
  assert.deepEqual(
    results.map((result) => result.score),
    [0, 0],
  );
  assert.deepEqual(
    results.map((result) => result.rank),
    [1, 1],
  );
}

{
  const candidates = [candidate("b", "2 Beta"), candidate("a", "1 Alpha")];
  const results = tallyVotes({
    voteType: "single",
    candidates,
    votes: [
      vote("vote-a", "a", "2026-06-01T10:00:00.000Z"),
      vote("vote-b", "b", "2026-06-01T10:00:00.000Z"),
    ],
  });
  assert.deepEqual(
    new Set(results.map((result) => result.candidateId)),
    new Set(["a", "b"]),
  );
  assert.deepEqual(
    results.map((result) => result.rank),
    [1, 1],
  );
  assert.deepEqual(
    results.map((result) => result.resolvedRank),
    [1, 2],
  );
}

console.log("tally tests passed");
