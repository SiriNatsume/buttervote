import Link from "next/link";
import { CalendarClock, Trophy } from "lucide-react";
import { statusLabel } from "@/lib/contest-rules";
import { getPublicImageUrl } from "@/lib/image/image-url";
import { formatDateTime } from "@/lib/time";
import type {
  TournamentBracketData,
  TournamentBracketMatch,
  TournamentBracketParticipant,
} from "@/lib/tournament-bracket";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

function matchHref(
  match: TournamentBracketMatch,
  contestHrefById?: Record<string, string>,
) {
  if (!match.contest) {
    return null;
  }

  if (contestHrefById?.[match.contest.id]) {
    return contestHrefById[match.contest.id];
  }

  if (match.contest.status === "voting") {
    return `/contests/${match.contest.id}/vote`;
  }

  if (match.resultVisible) {
    return `/contests/${match.contest.id}/results`;
  }

  return `/contests/${match.contest.id}`;
}

function actionLabel(match: TournamentBracketMatch) {
  if (!match.contest) {
    return "待生成";
  }

  if (match.contest.status === "voting") {
    return "去投票";
  }

  if (match.resultVisible) {
    return "看结果";
  }

  return "比赛详情";
}

function ParticipantRow({
  participant,
  resultVisible,
}: {
  participant: TournamentBracketParticipant | null;
  resultVisible: boolean;
}) {
  if (!participant) {
    return (
      <div className="rounded-xl border border-dashed border-[#EED8AA] bg-white/45 px-3 py-3 text-sm text-muted-foreground">
        待定
      </div>
    );
  }

  const imageUrl = getPublicImageUrl(participant.imagePath);

  return (
    <div
      className={cn(
        "flex min-h-[72px] items-center gap-3 rounded-xl border px-3 py-2",
        participant.isWinner && resultVisible
          ? "border-[#FFB347] bg-[#FFF3D0]"
          : "border-[#EED8AA]/70 bg-white/65",
      )}
    >
      <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={`${participant.name} 图片`}
            className="size-full object-cover"
          />
        ) : (
          <Trophy className="size-5 text-[#B9854C]" aria-hidden="true" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{participant.name}</div>
        {participant.seedLabel ? (
          <div className="mt-1 truncate text-xs text-muted-foreground">
            {participant.seedLabel}
          </div>
        ) : null}
      </div>
      {resultVisible && participant.score !== null ? (
        <div className="min-w-8 text-right text-lg font-semibold text-[#5C321E]">
          {participant.score}
        </div>
      ) : null}
    </div>
  );
}

function MatchCard({
  match,
  contestHrefById,
}: {
  match: TournamentBracketMatch;
  contestHrefById?: Record<string, string>;
}) {
  const href = matchHref(match, contestHrefById);

  return (
    <div className="rounded-2xl border border-[#EED8AA]/70 bg-[#FFFCF4]/90 p-3 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium text-muted-foreground">
            第 {match.slot} 场
          </div>
          <div className="mt-1 truncate text-sm font-semibold">
            {match.contest?.title ?? "比赛待生成"}
          </div>
        </div>
        {match.contest ? (
          <Badge variant={match.contest.status === "voting" ? "love" : "outline"}>
            {statusLabel[match.contest.status]}
          </Badge>
        ) : null}
      </div>

      <div className="space-y-2">
        <ParticipantRow
          participant={match.left}
          resultVisible={match.resultVisible}
        />
        <ParticipantRow
          participant={match.right}
          resultVisible={match.resultVisible}
        />
      </div>

      <div className="mt-3 space-y-3">
        {match.contest?.voting_starts_at || match.contest?.voting_ends_at ? (
          <div className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
            <CalendarClock className="mt-0.5 size-4 shrink-0" />
            <span>
              {match.contest.voting_starts_at
                ? formatDateTime(match.contest.voting_starts_at)
                : "未设置开始时间"}
              {" - "}
              {match.contest.voting_ends_at
                ? formatDateTime(match.contest.voting_ends_at)
                : "未设置结束时间"}
            </span>
          </div>
        ) : null}

        {match.contest && !match.resultVisible && match.contest.status === "closed" ? (
          <div className="rounded-xl border border-[#EED8AA]/70 bg-[#FFF8E8]/70 px-3 py-2 text-xs text-muted-foreground">
            结果待公开
          </div>
        ) : null}

        {href ? (
          <Button asChild size="sm" variant="outline" className="w-full">
            <Link href={href}>{actionLabel(match)}</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function TournamentBracket({
  bracket,
  contestHrefById,
}: {
  bracket: TournamentBracketData;
  contestHrefById?: Record<string, string>;
}) {
  if (bracket.rounds.length === 0) {
    return null;
  }

  return (
    <section className="rounded-3xl border border-[#EED8AA]/70 bg-[#FFF8E8]/60 p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-[#EED8AA] bg-white/70 px-3 py-1 text-sm font-medium text-[#8A5525]">
            <Trophy className="size-4" />
            正赛对阵
          </div>
          <h2 className="mt-3 text-2xl font-semibold tracking-normal text-[#5C321E]">
            {bracket.tournament.name}
          </h2>
        </div>
        <Badge variant="secondary">{bracket.tournament.status}</Badge>
      </div>

      <div className="grid gap-4 lg:grid-flow-col lg:auto-cols-[minmax(220px,1fr)]">
        {bracket.rounds.map((round) => (
          <div key={round.key} className="min-w-0">
            <div className="mb-3 rounded-full border border-[#EED8AA]/70 bg-white/70 px-3 py-1 text-center text-sm font-medium text-[#5C321E]">
              {round.label}
            </div>
            <div className="space-y-3">
              {round.matches.map((match) => (
                <MatchCard
                  key={match.id}
                  match={match}
                  contestHrefById={contestHrefById}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
