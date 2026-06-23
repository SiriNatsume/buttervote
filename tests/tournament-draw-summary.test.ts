import assert from "node:assert/strict";
import {
  buildPublicDrawSummaries,
  type PublicDrawSummary,
} from "../lib/tournament-draw-summary.ts";

function textOf(summary: PublicDrawSummary) {
  return JSON.stringify(summary);
}

{
  const summaries = buildPublicDrawSummaries(
    [
      {
        id: "log-preliminary",
        kind: "preliminary_draw",
        seed: "seed-preliminary",
        created_at: "2026-06-23T12:00:00.000Z",
        input: {
          advancers: [
            { candidateId: "secret-a", name: "角色 A", score: 10, position: 1 },
            { candidateId: "secret-b", name: "角色 B", score: 9, position: 2 },
          ],
          pool1: [{ candidateId: "secret-a", name: "角色 A", score: 10, position: 1 }],
          pool2: [{ candidateId: "secret-b", name: "角色 B", score: 9, position: 2 }],
          randomizedPoolBoundary: [
            { candidateId: "secret-b", name: "角色 B", score: 9, position: 2 },
          ],
          boundary: {
            score: 4,
            cutoffPosition: 48,
            isExtendedByTie: true,
            extraAdvancerCount: 2,
          },
        },
        output: {
          groups: {
            A: [{ candidateId: "secret-a", name: "角色 A", score: 10, position: 1 }],
            B: [{ candidateId: "secret-b", name: "角色 B", score: 9, position: 2 }],
            C: [],
            D: [],
          },
        },
      },
    ],
    "screening",
  );

  assert.equal(summaries.length, 1);
  assert.equal(summaries[0]?.title, "预赛分组抽签结果");
  assert.equal(summaries[0]?.seed, "seed-preliminary");
  assert.equal(summaries[0]?.groups?.length, 2);
  assert.match(summaries[0]?.ruleSummary ?? "", /Fisher|池 1/);
  assert(!textOf(summaries[0]!).includes("candidateId"));
  assert(!textOf(summaries[0]!).includes("secret-a"));
}

{
  const summaries = buildPublicDrawSummaries(
    [
      {
        id: "log-knockout",
        kind: "knockout_draw",
        seed: "seed-knockout",
        created_at: "2026-06-23T13:00:00.000Z",
        input: {
          finalists: [
            {
              entryId: "entry-a",
              name: "角色 A",
              preliminaryGroup: "A",
              preliminaryRank: 1,
            },
            {
              entryId: "entry-b",
              name: "角色 B",
              preliminaryGroup: "B",
              preliminaryRank: 2,
            },
          ],
        },
        output: {
          slots: [
            { slot: 1, entryId: "entry-a", fixedGroupWinner: "A" },
            { slot: 2, entryId: "entry-b", fixedGroupWinner: null },
          ],
        },
      },
    ],
    "knockout",
  );

  assert.equal(summaries.length, 1);
  assert.equal(summaries[0]?.title, "正赛 16 强抽签结果");
  assert.equal(summaries[0]?.slots?.[0]?.entryLabel, "角色 A（A 组第 1 名）");
  assert.equal(summaries[0]?.slots?.[0]?.fixedGroupWinner, "A");
  assert(!textOf(summaries[0]!).includes("entry-a"));
}

{
  const summaries = buildPublicDrawSummaries(
    [
      {
        id: "broken",
        kind: "preliminary_draw",
        seed: "seed-broken",
        created_at: "2026-06-23T14:00:00.000Z",
        input: null,
        output: { groups: null },
      },
      {
        id: "unknown",
        kind: "internal_debug",
        seed: "seed-unknown",
        created_at: "2026-06-23T15:00:00.000Z",
        input: { candidateId: "secret" },
        output: { entryId: "secret" },
      },
    ],
    "screening",
  );

  assert.deepEqual(summaries, []);
}

console.log("tournament draw summary tests passed");