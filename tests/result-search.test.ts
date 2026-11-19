import assert from "node:assert/strict";
import { test } from "node:test";
import { buildResultSearchItems } from "../lib/result-search.ts";
import { rankTallyResults } from "../lib/tally.ts";

test("search identifies each row in the full scoreboard and sends only its searchable display data", () => {
  const results = rankTallyResults([12, 9, 9, 5, 1].map((score, index) => ({
    candidateId: String(index),
    name: index === 2 ? "角色 1" : `角色 ${index}`,
    imagePath: `photo-${index}`,
    description: "full profile",
    nominatorDisplayName: "nominator",
    lastVoteAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    score, normalScore: score, loveScore: 0, loveBaseScore: 0, loveVoteCount: 0,
  })));
  const items = buildResultSearchItems(results, false);
  assert.deepEqual(items.map(({ rank, tied }) => [rank, tied]),
    [[1, false], [2, true], [2, true], [4, false], [5, false]]);
  assert.deepEqual(items[2], {
    rowId: "result-candidate-2", name: "角色 1", image_path: null, rank: 2, tied: true, score: 9,
  });
  assert.notEqual(items[1].rowId, items[2].rowId);
  assert.equal(buildResultSearchItems(results, true)[2].image_path, "photo-2");
});
