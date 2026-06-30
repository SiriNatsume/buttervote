import { Shuffle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/time";
import type {
  PublicDrawCandidate,
  PublicDrawSummary,
} from "@/lib/tournament-draw-summary";

function candidateMeta(candidate: PublicDrawCandidate) {
  const parts: string[] = [];

  if (candidate.screeningRank) {
    parts.push(`海选第 ${candidate.screeningRank} 名`);
  } else if (candidate.position) {
    parts.push(`排序第 ${candidate.position} 位`);
  } else if (candidate.rank) {
    parts.push(`票数第 ${candidate.rank} 名`);
  }

  if (candidate.preliminaryGroup) {
    parts.push(`${candidate.preliminaryGroup} 组`);
  }
  if (candidate.preliminaryRank) {
    parts.push(`预赛第 ${candidate.preliminaryRank} 名`);
  }
  if (typeof candidate.score === "number") {
    parts.push(`${candidate.score} 票`);
  }

  return parts.join(" · ");
}

export function TournamentDrawSummaryCard({
  summaries,
}: {
  summaries: PublicDrawSummary[];
}) {
  if (summaries.length === 0) {
    return null;
  }

  return (
    <Card className="border-[#EED8AA]/80 bg-[#FFFCF4]/95">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Shuffle className="size-5 text-[#B9854C]" aria-hidden="true" />
          <CardTitle>抽签透明度</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {summaries.map((summary) => (
          <details
            key={summary.id}
            className="group rounded-2xl border border-[#EED8AA]/70 bg-white/60 p-4"
          >
            <summary className="flex cursor-pointer list-none flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="font-semibold text-[#5C321E]">
                  {summary.title}
                </div>
                <div className="mt-2 flex min-w-0 flex-wrap gap-2 text-xs">
                  <Badge variant="secondary" className="min-w-0 shrink whitespace-normal break-all text-left">seed：{summary.seed}</Badge>
                  <Badge variant="outline" className="min-w-0 shrink whitespace-normal text-left">抽签方法：{summary.methodLabel}</Badge>
                  <Badge variant="outline" className="min-w-0 shrink whitespace-normal text-left">
                    生成时间：{formatDateTime(summary.createdAt)}
                  </Badge>
                  {summary.retractedAt ? (
                    <Badge variant="destructive">已撤回</Badge>
                  ) : null}
                </div>
                {summary.retractReason ? (
                  <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    撤回理由：{summary.retractReason}
                  </div>
                ) : null}
              </div>
              <span className="shrink-0 text-sm text-muted-foreground">
                展开查看
              </span>
            </summary>

            <div className="mt-4 space-y-4 border-t border-[#EED8AA]/70 pt-4">
              <div className="space-y-2 text-sm leading-6 text-[#6A3E21]">
                <div className="font-medium">规则摘要</div>
                <p>{summary.ruleSummary}</p>
              </div>

              {summary.inputSummary.length > 0 ? (
                <div className="space-y-2 text-sm leading-6 text-[#6A3E21]">
                  <div className="font-medium">输入摘要</div>
                  <ul className="space-y-1">
                    {summary.inputSummary.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="space-y-2 text-sm leading-6 text-[#6A3E21]">
                <div className="font-medium">复现方法</div>
                <ul className="space-y-1">
                  {summary.methodDetails.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>

              {summary.groups ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {summary.groups.map((group) => (
                    <div
                      key={group.label}
                      className="min-w-0 rounded-xl border border-[#EED8AA]/70 bg-[#FFF8E8]/70 p-3"
                    >
                      <div className="mb-2 font-medium text-[#5C321E]">
                        {group.label}
                      </div>
                      <div className="space-y-2">
                        {group.candidates.map((candidate, index) => (
                          <div
                            key={`${group.label}-${candidate.name}-${index}`}
                            className="rounded-lg bg-white/70 px-3 py-2 text-sm"
                          >
                            <div className="break-words font-medium">
                              {candidate.name}
                            </div>
                            {candidateMeta(candidate) ? (
                              <div className="mt-1 text-xs text-muted-foreground">
                                {candidateMeta(candidate)}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {summary.slots ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {summary.slots.map((slot) => (
                    <div
                      key={slot.slot}
                      className="min-w-0 rounded-xl border border-[#EED8AA]/70 bg-[#FFF8E8]/70 px-3 py-2 text-sm"
                    >
                      <div className="font-medium text-[#5C321E]">
                        槽位 {slot.slot}
                        {slot.fixedGroupWinner
                          ? ` · ${slot.fixedGroupWinner} 组第一固定`
                          : ""}
                      </div>
                      <div className="mt-1 break-words text-muted-foreground">
                        {slot.entryLabel ?? "待定"}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {summary.fallbackNote ? (
                <div className="rounded-xl bg-[#FFF8E8] px-3 py-2 text-sm text-muted-foreground">
                  {summary.fallbackNote}
                </div>
              ) : null}
            </div>
          </details>
        ))}
      </CardContent>
    </Card>
  );
}
