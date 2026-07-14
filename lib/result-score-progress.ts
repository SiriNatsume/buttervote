export type ResultScoreProgressModel = {
  primaryScore: number;
  loveScore: number;
  ariaLabel: string;
  primaryTitle: string;
  loveTitle: string | null;
};

export function buildResultScoreProgressModel({
  score,
  normalScore,
  loveScore,
  scoreLabel,
  showLoveBreakdown,
}: {
  score: number;
  normalScore: number;
  loveScore: number;
  scoreLabel: string;
  showLoveBreakdown: boolean;
}): ResultScoreProgressModel {
  if (!showLoveBreakdown) {
    return {
      primaryScore: score,
      loveScore: 0,
      ariaLabel: `${scoreLabel}进度：${score}`,
      primaryTitle: `${scoreLabel} ${score}`,
      loveTitle: null,
    };
  }

  return {
    primaryScore: normalScore,
    loveScore,
    ariaLabel: `得分进度：普通得分 ${normalScore}，真爱票得分 ${loveScore}`,
    primaryTitle: `普通得分 ${normalScore}`,
    loveTitle: `真爱票得分 ${loveScore}`,
  };
}
