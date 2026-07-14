import assert from "node:assert/strict";
import { buildResultScoreProgressModel } from "../lib/result-score-progress.ts";

{
  const progress = buildResultScoreProgressModel({
    score: 13,
    normalScore: 10,
    loveScore: 3,
    scoreLabel: "实时总分",
    showLoveBreakdown: false,
  });

  assert.deepEqual(progress, {
    primaryScore: 13,
    loveScore: 0,
    ariaLabel: "实时总分进度：13",
    primaryTitle: "实时总分 13",
    loveTitle: null,
  });
  assert.equal(JSON.stringify(progress).includes("真爱票"), false);
}

{
  const progress = buildResultScoreProgressModel({
    score: 25,
    normalScore: 10,
    loveScore: 15,
    scoreLabel: "总分",
    showLoveBreakdown: true,
  });

  assert.deepEqual(progress, {
    primaryScore: 10,
    loveScore: 15,
    ariaLabel: "得分进度：普通得分 10，真爱票得分 15",
    primaryTitle: "普通得分 10",
    loveTitle: "真爱票得分 15",
  });
}

{
  const progress = buildResultScoreProgressModel({
    score: 0,
    normalScore: 0,
    loveScore: 0,
    scoreLabel: "实时总分",
    showLoveBreakdown: false,
  });

  assert.equal(progress.primaryScore, 0);
  assert.equal(progress.loveScore, 0);
  assert.equal(progress.loveTitle, null);
}

console.log("result score progress tests passed");
