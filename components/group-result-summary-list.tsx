"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ImageIcon, Megaphone, Search, Trophy } from "lucide-react";
import { StatusBadge, VoteTypeBadge } from "@/components/contest-badges";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { statusLabel, voteTypeLabel } from "@/lib/contest-rules";
import { getPublicImageUrl } from "@/lib/image/image-url";
import { formatDateTime } from "@/lib/time";
import type { TallyResult } from "@/lib/tally";
import type {
  Contest,
  ContestCallingPhase,
  ContestCallingStatus,
  ContestStatus,
  VoteType,
} from "@/lib/types";

type ResultSummaryContest = Pick<
  Contest,
  "id" | "title" | "description" | "status" | "vote_type"
> & {
  resultPublishedAt: string | null;
};

export type GroupContestResultSummary = {
  contest: ResultSummaryContest;
  topResults: TallyResult[];
  calling?: {
    status: ContestCallingStatus;
    currentStep: number;
    totalSteps: number;
    phase: ContestCallingPhase | null;
    phaseStep: number | null;
    phaseTotal: number | null;
  } | null;
};

type GroupResultSummaryListProps = {
  summaries: GroupContestResultSummary[];
};

function summarySearchText(summary: GroupContestResultSummary) {
  const { contest, topResults } = summary;

  return [
    contest.title,
    contest.description,
    statusLabel[contest.status as ContestStatus],
    voteTypeLabel[contest.vote_type as VoteType],
    summary.calling ? "唱票 唱票中 唱票完成" : null,
    ...topResults.flatMap((result) => [result.name, result.description]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function CandidateThumb({ result }: { result: TallyResult }) {
  const imageUrl = getPublicImageUrl(result.imagePath);

  return (
    <div className="size-11 shrink-0 overflow-hidden rounded-xl bg-muted sm:size-12">
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={`${result.name} 图片`}
          className="size-full object-cover"
        />
      ) : (
        <div className="butter-placeholder flex size-full items-center justify-center">
          <ImageIcon className="size-4" aria-hidden="true" />
        </div>
      )}
    </div>
  );
}

export function GroupResultSummaryList({ summaries }: GroupResultSummaryListProps) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredSummaries = useMemo(() => {
    if (!normalizedQuery) {
      return summaries;
    }

    return summaries.filter((summary) =>
      summarySearchText(summary).includes(normalizedQuery),
    );
  }, [summaries, normalizedQuery]);

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">可查看结果</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {normalizedQuery
              ? `匹配 ${filteredSummaries.length} / ${summaries.length} 场活动`
              : `共 ${summaries.length} 场活动`}
          </p>
        </div>
        <label className="relative block w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索活动或候选项"
            className="pl-9"
            aria-label="搜索活动结果"
          />
        </label>
      </div>

      {summaries.length === 0 ? (
        <div className="rounded-2xl border p-8 text-muted-foreground">
          当前活动组暂无可查看结果。结果公开后会在这里显示。
        </div>
      ) : filteredSummaries.length > 0 ? (
        <div className="grid gap-5 md:grid-cols-2">
          {filteredSummaries.map(({ contest, topResults, calling }) => {
            const callingInProgress =
              calling?.status === "active" || calling?.status === "paused";
            const lovePhaseProgress =
              calling?.phase === "love_bonus" &&
              typeof calling.phaseStep === "number" &&
              typeof calling.phaseTotal === "number" &&
              calling.phaseStep > 0 &&
              calling.phaseTotal > 0
                ? "真爱票第 " + calling.phaseStep + " 张 / 共 " + calling.phaseTotal + " 张"
                : null;

            return (
            <Card
              key={contest.id}
              className="flex h-full min-w-0 flex-col overflow-hidden border-[#EED8AA]/70 bg-[#FFFCF4]/90"
            >
              <CardHeader className="min-w-0">
                <div className="mb-3 flex flex-wrap gap-2">
                  <StatusBadge status={contest.status} />
                  <VoteTypeBadge voteType={contest.vote_type} />
                  {callingInProgress ? (
                    <div className="inline-flex max-w-full shrink-0 items-center whitespace-nowrap rounded-full border border-[#F0D08A] bg-[#FFF3D0] px-2.5 py-0.5 text-xs font-semibold text-[#6A3E21]">
                      <Megaphone className="mr-1 size-3" />
                      {lovePhaseProgress ?? "唱票中"}
                    </div>
                  ) : null}
                </div>
                <CardTitle className="break-words leading-tight">
                  {contest.title}
                </CardTitle>
                {contest.resultPublishedAt ? (
                  <p className="text-xs text-muted-foreground">
                    结果发布时间：{formatDateTime(contest.resultPublishedAt)}
                  </p>
                ) : null}
              </CardHeader>
              <CardContent className="min-w-0 flex-1 space-y-3">
                <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">
                  {contest.description || "暂无简介。"}
                </p>
                {callingInProgress ? (
                  <div className="rounded-2xl border border-[#F0D08A] bg-[#FFF8E8] p-4 text-sm leading-6 text-[#6A3E21]">
                    <div className="font-medium">该活动正在唱票</div>
                    <div className="mt-1 text-muted-foreground">
                      当前第 {calling?.currentStep ?? 0} 张 / 共 {calling?.totalSteps ?? 0} 张。
                      {lovePhaseProgress ? lovePhaseProgress + "。" : null}
                      完整结果会在唱票完成后显示。
                    </div>
                  </div>
                ) : topResults.length > 0 ? (
                  <div className="min-w-0 space-y-2">
                    {topResults.map((result) => (
                      <div
                        key={result.candidateId}
                        className="flex min-w-0 items-center justify-between gap-3 rounded-2xl border border-[#EED8AA]/70 bg-white/70 px-3 py-2 text-sm"
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
                          <CandidateThumb result={result} />
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-2">
                              <Trophy className="size-4 shrink-0 text-[#B9854C]" />
                              <span className="shrink-0 text-xs text-muted-foreground">
                                第 {result.position} 名
                              </span>
                            </div>
                            <div className="truncate font-medium">
                              {result.name}
                            </div>
                          </div>
                        </div>
                        <span className="shrink-0 rounded-full border border-[#EED8AA]/70 bg-[#FFF3D0] px-2.5 py-1 font-semibold text-[#6A3E21]">
                          {result.score} 分
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl border p-4 text-sm text-muted-foreground">
                    暂无候选项或票数。
                  </div>
                )}
              </CardContent>
              <CardFooter className="min-w-0">
                <Button asChild className="w-full" variant="outline">
                  <Link href={`/contests/${contest.id}/results`}>
                    查看完整结果
                  </Link>
                </Button>
              </CardFooter>
            </Card>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border p-8 text-muted-foreground">
          没有找到匹配的活动结果。
        </div>
      )}
    </section>
  );
}