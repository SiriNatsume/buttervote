import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveTournamentMatchPresentation,
  type TournamentMatchTooltipData,
} from "../components/tournament-match-tooltip.tsx";

const participant = {
  name: "选手",
  imageUrl: null,
  score: 10,
  normalScore: 10,
  loveScore: 0,
  loveVoteCount: 0,
  isWinner: true,
};

function tooltipData(
  overrides: Partial<TournamentMatchTooltipData>,
): TournamentMatchTooltipData {
  return {
    contestId: "contest-1",
    contestTitle: "测试比赛",
    status: "closed",
    scheduledStartsAt: null,
    scheduledEndsAt: null,
    resultVisible: true,
    breakdownVisible: false,
    loveVoteWeight: null,
    tiebreakExplanation: "不应提前公开的平局说明",
    left: participant,
    right: { ...participant, name: "另一位选手", isWinner: false },
    ...overrides,
  };
}

test("closed public results show scores without unavailable breakdown details", () => {
  const presentation = resolveTournamentMatchPresentation(tooltipData({}));

  assert.equal(presentation.displayState, "results");
  assert.equal(presentation.showResults, true);
  assert.equal(presentation.showBreakdown, false);
  assert.equal(presentation.scoreQualifier, "（不含真爱票权重）");
  assert.equal(presentation.tiebreakExplanation, null);
});

test("published results show the weighted breakdown and tiebreak explanation", () => {
  const presentation = resolveTournamentMatchPresentation(
    tooltipData({ status: "published", breakdownVisible: true, loveVoteWeight: 3 }),
  );

  assert.equal(presentation.displayState, "results");
  assert.equal(presentation.showResults, true);
  assert.equal(presentation.showBreakdown, true);
  assert.equal(presentation.scoreQualifier, null);
  assert.equal(presentation.tiebreakExplanation, "不应提前公开的平局说明");
});

test("live results show base scores without the weighted breakdown", () => {
  const presentation = resolveTournamentMatchPresentation(
    tooltipData({ status: "voting" }),
  );

  assert.equal(presentation.displayState, "voting");
  assert.equal(presentation.showResults, true);
  assert.equal(presentation.showBreakdown, false);
  assert.equal(presentation.scoreQualifier, "（不含真爱票权重）");
  assert.equal(presentation.tiebreakExplanation, null);
});

test("closed hidden results do not show scores or breakdown details", () => {
  const presentation = resolveTournamentMatchPresentation(
    tooltipData({ resultVisible: false, breakdownVisible: true }),
  );

  assert.equal(presentation.displayState, "closed");
  assert.equal(presentation.showResults, false);
  assert.equal(presentation.showBreakdown, false);
  assert.equal(presentation.scoreQualifier, null);
  assert.equal(presentation.tiebreakExplanation, null);
});
