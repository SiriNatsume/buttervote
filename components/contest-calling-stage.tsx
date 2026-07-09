import { Heart, ImageIcon, Megaphone } from "lucide-react";
import { ContestCallingShareButton } from "@/components/contest-calling-share-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { getPublicImageUrl } from "@/lib/image/image-url";
import type {
  ContestCallingEventPayload,
  ContestCallingScoreSnapshot,
} from "@/lib/contest-calling";
import type { ContestCallingSession } from "@/lib/types";

type CallingSessionView = Pick<
  ContestCallingSession,
  "id" | "status" | "current_step" | "total_steps" | "play_mode" | "auto_interval_seconds"
>;

function statusText(status: CallingSessionView["status"]) {
  if (status === "completed") {
    return "唱票完成";
  }
  if (status === "active") {
    return "正在唱票";
  }
  if (status === "paused") {
    return "已暂停";
  }
  return "准备中";
}

function phaseBadge(event: ContestCallingEventPayload | null) {
  if (!event) {
    return <Badge variant="outline">等待开始</Badge>;
  }
  if (event.phase === "love_bonus") {
    return (
      <Badge variant="love">
        <Heart className="mr-1 size-3 fill-current" />
        真爱票加权
      </Badge>
    );
  }
  return <Badge variant="secondary">实时总分</Badge>;
}

function ScoreRows({ scores }: { scores: ContestCallingScoreSnapshot[] }) {
  const topScore = Math.max(...scores.map((score) => score.score), 1);

  return (
    <div className="space-y-2">
      {scores.slice(0, 8).map((score) => (
        <div
          key={score.candidateId}
          className={
            score.isCurrent
              ? "rounded-2xl border border-[#8FD69B] bg-[#ECFDF3] p-3"
              : "rounded-2xl border border-[#EED8AA]/70 bg-white/60 p-3"
          }
        >
          <div className="flex items-center justify-between gap-3 text-sm">
            <div className="min-w-0 font-medium text-[#5C321E]">
              <span className="mr-2 text-[#B9854C]">#{score.position}</span>
              <span className="break-words">{score.name}</span>
            </div>
            <div className="shrink-0 text-base font-semibold text-[#2F7A45]">
              {score.score}
            </div>
          </div>
          <Progress className="mt-2 h-2" value={(score.score / topScore) * 100} />
        </div>
      ))}
    </div>
  );
}

export function ContestCallingStage({
  contestId,
  contestTitle,
  session,
  event,
}: {
  contestId: string;
  contestTitle: string;
  session: CallingSessionView;
  event: ContestCallingEventPayload | null;
}) {
  const currentStep = Math.max(0, Number(session.current_step) || 0);
  const totalSteps = Math.max(0, Number(session.total_steps) || 0);
  const progress = totalSteps === 0 ? 0 : (currentStep / totalSteps) * 100;
  const lovePhaseProgress =
    event?.phase === "love_bonus" &&
    typeof event.metadata.phaseStep === "number" &&
    typeof event.metadata.phaseTotal === "number" &&
    event.metadata.phaseStep > 0 &&
    event.metadata.phaseTotal > 0
      ? `真爱票第 ${event.metadata.phaseStep} 张 / 共 ${event.metadata.phaseTotal} 张`
      : null;
  const imageUrl = event ? getPublicImageUrl(event.candidateSnapshot.imagePath) : null;
  const shareUrl = `/api/contests/${contestId}/calling-image?sessionId=${session.id}&step=${currentStep}`;
  const footerText =
    session.status === "completed"
      ? "唱票已完成，完整结果已恢复展示。"
      : "唱票进行中会隐藏完整结果；完成后恢复完整结果展示。";

  return (
    <Card className="border-[#F0D08A] bg-[#FFF8E8]">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">
            <Megaphone className="mr-1 size-3" />
            {statusText(session.status)}
          </Badge>
          {phaseBadge(event)}
          <Badge variant="outline">
            第 {currentStep} 张 / 共 {totalSteps} 张
          </Badge>
          {lovePhaseProgress ? (
            <Badge variant="outline" className="border-[#FFB3C1] text-[#C73555]">
              {lovePhaseProgress}
            </Badge>
          ) : null}
        </div>
        <CardTitle>唱票进度</CardTitle>
        <Progress value={progress} />
      </CardHeader>
      <CardContent className="space-y-5">
        {event ? (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
            <div className="rounded-3xl border border-[#EED8AA]/80 bg-[#FFFCF4] p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="size-24 shrink-0 overflow-hidden rounded-3xl bg-[#FFF1CF] sm:size-28">
                  {imageUrl ? (
                    <img
                      src={imageUrl}
                      alt={`${event.candidateSnapshot.name} 图片`}
                      className="size-full object-cover"
                    />
                  ) : (
                    <div className="butter-placeholder flex size-full items-center justify-center">
                      <ImageIcon className="size-8" aria-hidden="true" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-[#B9854C]">
                    {event.phase === "love_bonus"
                      ? (lovePhaseProgress ?? "真爱票补充加权")
                      : "基础唱票"}
                  </div>
                  <div className="mt-1 break-words text-2xl font-semibold text-[#5C321E]">
                    {event.candidateSnapshot.name}
                  </div>
                  <div
                    className={
                      event.phase === "love_bonus"
                        ? "mt-3 text-3xl font-semibold text-[#C73555]"
                        : "mt-3 text-3xl font-semibold text-[#2F7A45]"
                    }
                  >
                    +{event.deltaScore} 分
                  </div>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    {event.phase === "love_bonus"
                      ? "本张展示真爱票的加权补充分。"
                      : "本阶段展示实时总分，不含真爱票权重。"}
                  </p>
                </div>
              </div>
            </div>
            <div className="space-y-3">
              <div className="text-sm font-medium text-[#5C321E]">当前榜单</div>
              <ScoreRows scores={event.scores} />
            </div>
          </div>
        ) : (
          <div className="rounded-3xl border border-dashed border-[#EED8AA] bg-[#FFFCF4] p-8 text-center text-muted-foreground">
            管理员开始唱票后，这里会显示第一张唱票卡。
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#EED8AA]/70 bg-[#FFFCF4]/80 p-4 text-sm text-muted-foreground">
          <span>{footerText}</span>
          <ContestCallingShareButton
            contestTitle={contestTitle}
            imageUrl={shareUrl}
            step={currentStep}
          />
        </div>
      </CardContent>
    </Card>
  );
}