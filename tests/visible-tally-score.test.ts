import assert from "node:assert/strict";
import test from "node:test";
import { tallyVotes } from "../lib/tally";
import { visibleTallyScore } from "../lib/visible-tally-score";
import { tallyResultsFromAggregates } from "../lib/aggregate-tallies";
import type { VoteType } from "../lib/types";

for (const voteType of ["single", "multiple", "ranked"] satisfies VoteType[]) {
  for (const weight of [1, 2.5, 3]) {
    test(`aggregate scores preserve ${voteType} results and hide the bonus at weight ${weight}`, () => {
      const candidates = ["a", "b", "unvoted"].map((id) => ({
        id, name: id, description: null, image_path: null,
        nominator_display_name: null, is_active: true,
      }));
      const payload = voteType === "single" ? { candidateId: "a" }
        : voteType === "multiple" ? { candidateIds: ["a", "b"] }
          : { ranking: ["b", "a"] };
      const params = {
        voteType, candidates, loveVoteWeight: weight,
        votes: ["normal", "love"].map((id) => ({
          id, contest_id: "contest", voter_id: null, payload,
          created_at: "2026-10-18T00:00:00.000Z",
        })),
        loveAllocations: [{ vote_id: "love", candidate_id: "a" }],
      };
      const weighted = tallyVotes(params);
      const base = new Map(tallyVotes({ ...params, loveVoteScoreMode: "base" })
        .map((result) => [result.candidateId, result.score]));
      for (const result of weighted) {
        const row = { score: result.score, normal_score: result.normalScore, love_score: result.loveScore };
        assert.equal(visibleTallyScore(row, true, weight), result.score);
        assert.equal(visibleTallyScore(row, false, weight), base.get(result.candidateId));
      }
      const tallies = weighted.map((result) => ({
        contest_id: "contest", candidate_id: result.candidateId,
        score: result.score, normal_score: result.normalScore, love_score: result.loveScore,
        love_vote_count: result.loveVoteCount, last_vote_at: result.lastVoteAt,
      }));
      assert.deepEqual(tallyResultsFromAggregates({
        candidates, tallies, loveVoteWeight: weight, showWeightedLoveScore: true,
      }), weighted);
      // Public live results must not serialize love-vote details, even if a
      // caller accidentally supplies a row containing the weighted breakdown.
      assert.deepEqual(tallyResultsFromAggregates({
        candidates, tallies, loveVoteWeight: weight, showWeightedLoveScore: false,
      }), tallyVotes({ ...params, loveAllocations: [] }));
    });
  }
}

test("incomplete aggregates never fabricate zero-score results", () => {
  assert.deepEqual(tallyResultsFromAggregates({
    candidates: [{ id: "missing", name: "Missing", description: null, image_path: null,
      nominator_display_name: null, is_active: true }],
    tallies: [], loveVoteWeight: 3, showWeightedLoveScore: true,
  }), []);
});
