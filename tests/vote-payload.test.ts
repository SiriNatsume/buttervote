import assert from "node:assert/strict";
import { selectedCandidateIdsFromVotePayload } from "../lib/vote-payload.ts";

assert.deepEqual(
  selectedCandidateIdsFromVotePayload("single", { candidateId: "a" }),
  ["a"],
);

assert.deepEqual(
  selectedCandidateIdsFromVotePayload("multiple", {
    candidateIds: ["a", "b", "a", ""],
  }),
  ["a", "b"],
);

assert.deepEqual(
  selectedCandidateIdsFromVotePayload("ranked", {
    ranking: ["c", "b", "c"],
  }),
  ["c", "b"],
);

assert.deepEqual(selectedCandidateIdsFromVotePayload("single", null), []);
assert.deepEqual(
  selectedCandidateIdsFromVotePayload("multiple", { candidateIds: "a" }),
  [],
);

console.log("vote payload tests passed");