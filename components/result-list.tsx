import { ChevronDown } from "lucide-react";
import { ResultCandidateFinder } from "@/components/result-candidate-finder";
import { VoteCandidateThumb } from "@/components/vote-candidate-thumb";
import { buildResultScoreProgressModel } from "@/lib/result-score-progress";
import { buildResultSearchItems } from "@/lib/result-search";
import type { TallyResult } from "@/lib/tally";
import { formatDateTime } from "@/lib/time";
import { Badge } from "@/components/ui/badge";

function ScoreBreakdownProgress({
  score,
  normalScore,
  loveScore,
  topScore,
  scoreLabel,
  showLoveBreakdown,
}: {
  score: number;
  normalScore: number;
  loveScore: number;
  topScore: number;
  scoreLabel: string;
  showLoveBreakdown: boolean;
}) {
  const progress = buildResultScoreProgressModel({
    score,
    normalScore,
    loveScore,
    scoreLabel,
    showLoveBreakdown,
  });
  const safeTopScore = Math.max(topScore, 1);
  const normalPercent = Math.min(
    100,
    Math.max(0, (progress.primaryScore / safeTopScore) * 100),
  );
  const lovePercent = Math.min(
    100 - normalPercent,
    Math.max(0, (progress.loveScore / safeTopScore) * 100),
  );

  return (
    <div
      className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-[#FFE7B0]"
      role="progressbar"
      aria-label={progress.ariaLabel}
      aria-valuemin={0}
      aria-valuemax={safeTopScore}
      aria-valuenow={Math.min(
        safeTopScore,
        progress.primaryScore + progress.loveScore,
      )}
    >
      <div
        className="h-full shrink-0 bg-[#3F7FA6] transition-[width]"
        style={{ width: `${normalPercent}%` }}
        title={progress.primaryTitle}
      />
      {progress.loveTitle ? (
        <div
          className="h-full shrink-0 bg-[#D6405A] transition-[width]"
          style={{ width: `${lovePercent}%` }}
          title={progress.loveTitle}
        />
      ) : null}
    </div>
  );
}

export function ResultList({
  results,
  showImage = true,
  showDescription = true,
  showNominatorInfo = true,
  showLoveBreakdown = true,
  scoreLabel = "总分",
}: {
  results: TallyResult[];
  showImage?: boolean;
  showDescription?: boolean;
  showNominatorInfo?: boolean;
  showLoveBreakdown?: boolean;
  scoreLabel?: string;
}) {
  const topScore = results.reduce((highest, result) => Math.max(highest, result.score), 1);
  const items = buildResultSearchItems(results, showImage);

  return (
    <section aria-label="本场完整排名" className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-xl font-semibold">完整排名</h2>
        <span className="text-sm text-muted-foreground">{scoreLabel}</span>
      </div>
      <ResultCandidateFinder items={items} showImage={showImage} scoreLabel={scoreLabel} />
      <ol className="divide-y divide-[#ECDEC6] rounded-2xl border bg-[#FFFCF4]">
        {results.map((result, index) => {
          const item = items[index];
          return (
            <li key={result.candidateId}>
              <details className="group/row">
                <summary
                  id={item.rowId}
                  className="group/item flex min-h-[3.75rem] cursor-pointer list-none items-center gap-2 rounded-xl px-2.5 py-1.5 hover:bg-[#FFF6E4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-[current=true]:bg-[#FFF0CF] aria-[current=true]:shadow-[inset_3px_0_0_#B55627] sm:gap-3 sm:px-4 [&::-webkit-details-marker]:hidden"
                >
                  <span className="min-w-8 shrink-0 text-center font-semibold tabular-nums">
                    <span className="sr-only">{item.tied ? "并列第" : "第"}</span>{result.rank}<span className="sr-only">名</span>
                    {item.tied && <span aria-hidden="true" className="block text-xs font-normal text-muted-foreground">并列</span>}
                  </span>
                  <VoteCandidateThumb candidate={item} show={showImage} compact />
                  <span className="min-w-0 flex-1 break-words font-medium">
                    {result.name}
                    {result.isActive === false && <Badge variant="outline" className="ml-1.5">已删除</Badge>}
                    <span className="ml-1.5 hidden text-xs text-[#894824] group-aria-[current=true]/item:inline">已定位</span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">
                    <span className="sr-only">{scoreLabel} </span>{result.score} <span className="text-xs font-normal text-muted-foreground">分</span>
                  </span>
                  <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground group-open/row:rotate-180" />
                </summary>
                <div className="space-y-2 border-t border-dashed px-3 py-3 text-sm text-muted-foreground sm:px-4">
                  <p>榜单排序第 {result.position} 位</p>
                  {showLoveBreakdown && (
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      <span>普通得分 {result.normalScore}</span>
                      <span className="text-[#B33753]">真爱票得分 {result.loveScore}（{result.loveVoteCount} 张）</span>
                    </div>
                  )}
                  {showDescription && result.description && <p className="whitespace-pre-line break-words">{result.description}</p>}
                  {showNominatorInfo && result.nominatorDisplayName && <p>提名者：{result.nominatorDisplayName}</p>}
                  {result.lastVoteAt && <p>最后得票时间：{formatDateTime(result.lastVoteAt)}</p>}
                  <ScoreBreakdownProgress
                    score={result.score}
                    normalScore={result.normalScore}
                    loveScore={result.loveScore}
                    topScore={topScore}
                    scoreLabel={scoreLabel}
                    showLoveBreakdown={showLoveBreakdown}
                  />
                </div>
              </details>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
