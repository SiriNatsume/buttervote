"use client";

import { type CSSProperties, useEffect, useRef, useState } from "react";
import { ImageIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { RelativeContestTime } from "@/components/relative-contest-time";
import {
  TournamentMatchTooltip,
  type TournamentMatchTooltipData,
} from "@/components/tournament-match-tooltip";
import {
  contestRelativeTimeMode,
  contestRelativeTimeTarget,
  type GroupHomepageContest,
  type GroupHomepageParticipant,
} from "@/lib/group-homepage";
import {
  contestRankStyles,
  defaultContestRankBadgeStyle,
  formatContestOrdinal,
} from "@/lib/contest-rank-styles";
import { cn } from "@/lib/utils";

function ParticipantImage({
  participant,
  compact = false,
}: {
  participant: GroupHomepageParticipant;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "shrink-0 overflow-hidden rounded border border-black/10 bg-muted",
        compact ? "size-6" : "size-7 sm:size-8",
      )}
    >
      {participant.imageUrl ? (
        <img
          src={participant.imageUrl}
          alt=""
          className="size-full object-cover"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div className="butter-placeholder flex size-full items-center justify-center">
          <ImageIcon className="size-3" aria-hidden="true" />
        </div>
      )}
    </div>
  );
}

function ContestThumbnail({ contest }: { contest: GroupHomepageContest }) {
  return (
    <div className="aspect-video w-24 shrink-0 self-center overflow-hidden border-r border-[#DCC69F]/70 bg-muted sm:w-28">
      {contest.imageUrl ? (
        <img
          src={contest.imageUrl}
          alt=""
          className="size-full object-cover"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div className="butter-placeholder flex size-full items-center justify-center text-muted-foreground/70">
          <ImageIcon className="size-4" aria-hidden="true" />
        </div>
      )}
    </div>
  );
}

function Score({
  participant,
  highlightWinner = true,
}: {
  participant: GroupHomepageParticipant;
  highlightWinner?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-w-6 items-center justify-center rounded px-1 py-0.5 text-[11px] font-bold tabular-nums",
        highlightWinner && participant.isWinner
          ? "bg-[#376B4A] text-white"
          : "bg-black/5 text-[#3F2418]",
      )}
    >
      {participant.score}
    </span>
  );
}

function HeadToHead({ participants }: { participants: GroupHomepageParticipant[] }) {
  const [left, right] = participants;
  if (!left || !right) return null;
  const scoresVisible = left.score !== null && right.score !== null;
  return (
    <div className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1.5 px-2.5 py-1.5">
      <div className="flex min-w-0 items-center justify-end gap-1.5 text-right">
        <span className="break-words text-[11px] font-semibold sm:text-xs">
          {left.name}
        </span>
        <ParticipantImage participant={left} />
      </div>
      {scoresVisible ? (
        <div className="flex items-center gap-1.5 font-bold">
          <Score participant={left} />
          <Score participant={right} />
        </div>
      ) : (
        <span className="w-9" aria-hidden="true" />
      )}
      <div className="flex min-w-0 items-center gap-1.5">
        <ParticipantImage participant={right} />
        <span className="break-words text-[11px] font-semibold sm:text-xs">
          {right.name}
        </span>
      </div>
    </div>
  );
}

function ParticipantRankBadge({ rank }: { rank: number }) {
  return (
    <span
      className={cn(
        "inline-flex min-w-5 shrink-0 items-center justify-center rounded px-1 py-0.5 text-[9px] font-bold leading-none tabular-nums",
        contestRankStyles[rank - 1]?.badge ?? defaultContestRankBadgeStyle,
      )}
      aria-label={`第 ${rank} 名`}
    >
      {formatContestOrdinal(rank)}
    </span>
  );
}

function MarqueeParticipant({
  participant,
  rank,
}: {
  participant: GroupHomepageParticipant;
  rank: number;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 rounded-md border border-[#E8DCC3] bg-white/75 px-1.5 py-0.5">
      <ParticipantImage participant={participant} compact />
      {participant.score !== null ? <ParticipantRankBadge rank={rank} /> : null}
      <span className="whitespace-nowrap text-[11px] font-semibold sm:text-xs">
        {participant.name}
      </span>
      {participant.score !== null ? (
        <Score participant={participant} highlightWinner={false} />
      ) : null}
    </div>
  );
}

function StaticMultiParticipantList({
  participants,
}: {
  participants: GroupHomepageParticipant[];
}) {
  return (
    <div className="grid min-h-16 grid-flow-col grid-cols-2 grid-rows-2 gap-1 p-1.5">
      {participants.map((participant, index) => (
        <div
          key={participant.id}
          className="flex min-w-0 items-center gap-1.5 rounded-md border border-[#E8DCC3] bg-white/75 px-1.5 py-0.5"
        >
          <ParticipantImage participant={participant} compact />
          {participant.score !== null ? (
            <ParticipantRankBadge rank={index + 1} />
          ) : null}
          <span className="min-w-0 flex-1 break-words text-[11px] font-semibold leading-4 sm:text-xs">
            {participant.name}
          </span>
          {participant.score !== null ? (
            <Score participant={participant} highlightWinner={false} />
          ) : null}
        </div>
      ))}
    </div>
  );
}

function MultiParticipantMarquee({
  participants,
}: {
  participants: GroupHomepageParticipant[];
}) {
  const firstCopyRef = useRef<HTMLDivElement>(null);
  const resumeTimerRef = useRef<number | null>(null);
  const [copyWidth, setCopyWidth] = useState(0);
  const [touchPaused, setTouchPaused] = useState(false);

  useEffect(() => {
    const element = firstCopyRef.current;
    if (!element) return;
    const update = () => setCopyWidth(element.getBoundingClientRect().width);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [participants]);

  useEffect(
    () => () => {
      if (resumeTimerRef.current) window.clearTimeout(resumeTimerRef.current);
    },
    [],
  );

  const style = {
    "--group-marquee-distance": `${copyWidth}px`,
    "--group-marquee-duration": `${Math.max(10, copyWidth / 42)}s`,
  } as CSSProperties;

  function pauseForTouch() {
    if (resumeTimerRef.current) window.clearTimeout(resumeTimerRef.current);
    setTouchPaused(true);
  }

  function resumeAfterTouch() {
    if (resumeTimerRef.current) window.clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = window.setTimeout(() => setTouchPaused(false), 1500);
  }

  return (
    <div
      className="group-homepage-marquee min-h-16 overflow-hidden px-1.5 py-1"
      onTouchStart={pauseForTouch}
      onTouchEnd={resumeAfterTouch}
      onTouchCancel={resumeAfterTouch}
    >
      <div
        className={cn(
          "group-homepage-marquee-track flex w-max gap-2",
          (touchPaused || copyWidth === 0) && "group-homepage-marquee-paused",
        )}
        style={style}
      >
        {[0, 1, 2].map((copy) => (
          <div
            key={copy}
            ref={copy === 0 ? firstCopyRef : undefined}
            aria-hidden={copy === 0 ? undefined : true}
            className={cn(
              "grid shrink-0 auto-cols-max grid-flow-col grid-rows-2 gap-1 pr-2",
              copy > 0 && "group-homepage-marquee-copy-duplicate",
            )}
          >
            {participants.map((participant, index) => (
              <MarqueeParticipant
                key={`${copy}-${participant.id}`}
                participant={participant}
                rank={index + 1}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function GroupContestControl({
  contest,
  referenceNow,
  href = `/contests/${contest.id}`,
}: {
  contest: GroupHomepageContest;
  referenceNow: number;
  href?: string;
}) {
  const timeTarget = contestRelativeTimeTarget(contest);
  const timeMode = contestRelativeTimeMode(contest);
  const isNominating = contest.status === "nominating";
  const displayedParticipants = contest.participants.slice(0, 16);
  const [left, right] = displayedParticipants;
  const tooltipParticipant = (
    participant: GroupHomepageParticipant | undefined,
  ) =>
    participant
      ? {
          name: participant.name,
          imageUrl: participant.imageUrl,
          score: participant.score,
          normalScore: participant.normalScore,
          loveScore: participant.loveScore,
          loveVoteCount: participant.loveVoteCount,
          isWinner: participant.isWinner,
        }
      : null;
  const tooltipData: TournamentMatchTooltipData = {
    contestId: contest.id,
    detailsHref: href,
    contestTitle: contest.title,
    status: contest.status,
    scheduledStartsAt: contest.votingStartsAt,
    scheduledEndsAt: contest.votingEndsAt,
    resultVisible: contest.resultVisible,
    breakdownVisible: contest.breakdownVisible,
    loveVoteWeight: contest.loveVoteWeight,
    tiebreakExplanation: null,
    left: tooltipParticipant(left),
    right: tooltipParticipant(right),
    participants: displayedParticipants.map((participant) =>
      tooltipParticipant(participant),
    ).filter((participant): participant is NonNullable<typeof participant> =>
      participant !== null,
    ),
  };

  const content = (
    <div
      className="group block min-w-0 max-w-full overflow-hidden rounded-xl border border-[#DCC69F] bg-[#FFFCF4]/90 shadow-sm transition hover:border-orange-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex min-h-16 overflow-hidden bg-[#FFFCF4]/90">
        <ContestThumbnail contest={contest} />
        <div className="min-w-0 flex-1">
          {isNominating ? (
            <div className="flex min-h-16 items-center justify-center p-2">
              <Badge className="px-2.5 py-0.5 text-[11px]">提名中</Badge>
            </div>
          ) : displayedParticipants.length === 2 ? (
            <HeadToHead participants={displayedParticipants} />
          ) : displayedParticipants.length > 0 && displayedParticipants.length <= 4 ? (
            <StaticMultiParticipantList participants={displayedParticipants} />
          ) : displayedParticipants.length > 0 ? (
            <MultiParticipantMarquee participants={displayedParticipants} />
          ) : (
            <div className="flex min-h-16 items-center justify-center p-2 text-[11px] text-muted-foreground">
              选项尚未公布
            </div>
          )}
        </div>
      </div>
      <div className="flex min-h-6 items-center justify-between gap-3 bg-[#FAEED4] px-2.5 py-0.5 text-[#5A3826]">
        <span className="min-w-0 break-words text-[11px] font-medium leading-4">{contest.title}</span>
        <span className="shrink-0 text-[10px] leading-4 text-[#7A5B37]">
          <RelativeContestTime
            target={timeTarget}
            referenceNow={referenceNow}
            mode={timeMode}
          />
        </span>
      </div>
    </div>
  );

  return (
    <TournamentMatchTooltip data={tooltipData}>
      {content}
    </TournamentMatchTooltip>
  );
}
