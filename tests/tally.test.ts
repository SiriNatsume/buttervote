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

{
  const candidates = [candidate("a", "Alpha"), candidate("b", "Beta")];
  const votes = [
    vote("vote-a", "a", "2026-06-01T10:00:00.000Z"),
    vote("vote-b", "b", "2026-06-01T09:00:00.000Z"),
  ];
  const loveAllocations = [{ vote_id: "vote-a", candidate_id: "a" }];

  const weightedResults = tallyVotes({
    voteType: "single",
    candidates,
    votes,
    loveVoteWeight: 3,
    loveAllocations,
  });
  assert.equal(weightedResults[0]?.candidateId, "a");
  assert.equal(weightedResults[0]?.score, 3);
  assert.equal(weightedResults[0]?.loveScore, 3);
  assert.equal(weightedResults[0]?.loveBaseScore, 1);
  assert.equal(weightedResults[0]?.loveVoteCount, 1);

  const liveResults = tallyVotes({
    voteType: "single",
    candidates,
    votes,
    loveVoteWeight: 3,
    loveVoteScoreMode: "base",
    loveAllocations,
  });
  assert.deepEqual(
    liveResults.map((result) => result.candidateId),
    ["b", "a"],
  );
  assert.equal(
    liveResults.find((result) => result.candidateId === "a")?.score,
    1,
  );
  assert.equal(
    liveResults.find((result) => result.candidateId === "a")?.loveScore,
    1,
  );
}

{
  const results = tallyVotes({
    voteType: "ranked",
    candidates: [candidate("a", "Alpha"), candidate("b", "Beta")],
    votes: [
      {
        id: "vote-ranked",
        contest_id: "contest",
        voter_id: "voter-ranked",
        payload: { ranking: ["a", "b"] },
        created_at: "2026-06-01T10:00:00.000Z",
      },
    ],
    loveVoteWeight: 4,
    loveVoteScoreMode: "base",
    loveAllocations: [
      { vote_id: "vote-ranked", candidate_id: "a" },
      { vote_id: "vote-ranked", candidate_id: "b" },
    ],
  });

  const first = results.find((result) => result.candidateId === "a");
  const second = results.find((result) => result.candidateId === "b");
  assert.equal(first?.score, 3);
  assert.equal(first?.loveScore, 3);
  assert.equal(first?.loveBaseScore, 3);
  assert.equal(second?.score, 2);
  assert.equal(second?.loveScore, 2);
  assert.equal(second?.loveBaseScore, 2);
}
console.log("tally tests passed");
