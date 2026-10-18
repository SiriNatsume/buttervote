/** Recover integer base points when live results must hide the love bonus. */
export function visibleTallyScore(
  tally: { score: number; normal_score: number; love_score: number },
  showWeightedLoveScore: boolean,
  loveVoteWeight: number,
) {
  return showWeightedLoveScore
    ? tally.score
    : tally.normal_score + Math.round(tally.love_score / loveVoteWeight);
}
