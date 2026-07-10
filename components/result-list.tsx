import { Heart, ImageIcon, Trophy } from "lucide-react";
import { getPublicImageUrl } from "@/lib/image/image-url";
import type { TallyResult } from "@/lib/tally";
import { formatDateTime } from "@/lib/time";
import { Badge } from "@/components/ui/badge";

function ScoreBreakdownProgress({
  normalScore,
  loveScore,
  topScore,
}: {
  normalScore: number;
  loveScore: number;
  topScore: number;
}) {
  const safeTopScore = Math.max(topScore, 1);
  const normalPercent = Math.min(
    100,
    Math.max(0, (normalScore / safeTopScore) * 100),
  );
  const lovePercent = Math.min(
    100 - normalPercent,
    Math.max(0, (loveScore / safeTopScore) * 100),
  );

  return (
    <div
      className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-[#FFE7B0]"
      role="progressbar"
      aria-label={`得分进度：普通得分 ${normalScore}，真爱票得分 ${loveScore}`}
      aria-valuemin={0}
      aria-valuemax={safeTopScore}
      aria-valuenow={Math.min(safeTopScore, normalScore + loveScore)}
    >
      <div
        className="h-full shrink-0 bg-[#3F7FA6] transition-[width]"
        style={{ width: `${normalPercent}%` }}
        title={`普通得分 ${normalScore}`}
      />
      <div
        className="h-full shrink-0 bg-[#D6405A] transition-[width]"
        style={{ width: `${lovePercent}%` }}
        title={`真爱票得分 ${loveScore}`}
      />
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
  const topScore = Math.max(...results.map((item) => item.score), 1);

  return (
    <div className="space-y-4">
      {results.map((result) => {
        const imageUrl = getPublicImageUrl(result.imagePath);

        return (
          <div
            key={result.candidateId}
            className="rounded-3xl border border-[#EED8AA]/70 bg-[#FFFCF4]/90 p-5 shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 gap-3">
                {showImage ? (
                  <div className="size-14 shrink-0 overflow-hidden rounded-2xl bg-muted sm:size-16">
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={`${result.name} 图片`}
                        className="size-full object-cover"
                      />
                    ) : (
                      <div className="butter-placeholder flex size-full items-center justify-center">
                        <ImageIcon className="size-5" aria-hidden="true" />
                      </div>
                    )}
                  </div>
                ) : null}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className={
                        result.position === 1
                          ? "border-yellow-300 bg-yellow-100 text-yellow-800"
                          : "border-[#EED8AA] bg-[#FFF3D0] text-[#6A3E21]"
                      }
                    >
                      <Trophy className="mr-1 size-3" />
                      排序第 {result.position} 位
                    </Badge>
                    {result.rank !== result.position ? (
                      <Badge variant="outline">票数并列第 {result.rank} 名</Badge>
                    ) : null}
                    {result.isActive === false ? (
                      <Badge variant="outline">已删除</Badge>
                    ) : null}
                    <h3 className="font-semibold">{result.name}</h3>
                  </div>
                  {showDescription && result.description ? (
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {result.description}
                    </p>
                  ) : null}
                  {showNominatorInfo && result.nominatorDisplayName ? (
                    <div className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
                      <div>提名者：{result.nominatorDisplayName}</div>
                    </div>
                  ) : null}
                  {showLoveBreakdown ? (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-[#C73555]">
                      <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-[#FFB3C1] bg-[#FFE4EA] px-2.5 py-1">
                        <Heart className="size-3 fill-current" />
                        普通得分 {result.normalScore}
                      </span>
                      <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-[#FFB3C1] bg-[#FFE4EA] px-2.5 py-1">
                        真爱票得分 {result.loveScore}
                      </span>
                      <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-[#FFB3C1] bg-[#FFE4EA] px-2.5 py-1">
                        真爱票 {result.loveVoteCount} 张
                      </span>
                    </div>
                  ) : null}
                  {result.lastVoteAt ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      最后得票时间：{formatDateTime(result.lastVoteAt)}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="text-right text-sm">
                <div className="text-2xl font-semibold">{result.score}</div>
                <div className="text-muted-foreground">{scoreLabel}</div>
              </div>
            </div>
            <ScoreBreakdownProgress
              normalScore={result.normalScore}
              loveScore={result.loveScore}
              topScore={topScore}
            />
          </div>
        );
      })}
    </div>
  );
}
