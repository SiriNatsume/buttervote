import { Trophy } from "lucide-react";
import { statusLabel } from "@/lib/contest-rules";
import { getPublicImageUrl } from "@/lib/image/image-url";
import type {
  TournamentBracketData,
  TournamentBracketMatch,
  TournamentBracketParticipant,
} from "@/lib/tournament-bracket";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

function ParticipantRow({
  participant,
  resultVisible,
}: {
  participant: TournamentBracketParticipant | null;
  resultVisible: boolean;
}) {
  if (!participant) {
    return (
      <div className="rounded-xl border border-dashed border-[#EED8AA] bg-white/45 px-3 py-2 text-sm text-muted-foreground">
        待定
      </div>
    );
  }

  const imageUrl = getPublicImageUrl(participant.imagePath);

  return (
    <div
      className={cn(
        "flex min-h-[76px] items-center gap-3 rounded-xl border px-3 py-2.5",
        participant.isWinner && resultVisible
          ? "border-[#65A96E] bg-[#ECF8E9] shadow-[inset_3px_0_0_#3C8B4F]"
          : "border-[#EED8AA]/70 bg-white/65",
      )}
    >
      <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={`${participant.name} 图片`}
            className="size-full object-cover"
          />
        ) : (
          <Trophy className="size-4 text-[#B9854C]" aria-hidden="true" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="break-words text-[15px] font-semibold leading-5 text-[#4A2B1B]">
          {participant.name}
        </div>
        {participant.seedLabel ? (
          <div className="mt-1 break-words text-xs leading-4 text-muted-foreground">
            {participant.seedLabel}
          </div>
        ) : null}
      </div>
      {resultVisible && participant.score !== null ? (
        <div
          className={cn(
            "min-w-7 text-right text-base font-semibold text-[#5C321E]",
            participant.isWinner && "text-[#2F7A42]",
          )}
        >
          {participant.score}
        </div>
      ) : null}
    </div>
  );
}

const ROUND_LABEL: Record<string, string> = {
  round_of_16: "16 强",
  quarterfinal: "8 强",
  semifinal: "半决赛",
  final: "冠军赛",
  third_place: "季军赛",
};

function roundLabel(round: string) {
  return ROUND_LABEL[round] ?? "正赛";
}

function matchByRoundSlot(bracket: TournamentBracketData) {
  const matches = new Map<string, TournamentBracketMatch>();
  for (const round of bracket.rounds) {
    for (const match of round.matches) {
      matches.set(`${match.round}:${match.slot}`, match);
    }
  }
  return matches;
}

function TopologyMatchNode({
  round,
  slot,
  match,
  center = false,
}: {
  round: string;
  slot: number;
  match: TournamentBracketMatch | null;
  center?: boolean;
}) {
  const resultVisible = match?.resultVisible ?? false;

  return (
    <div
      className={cn(
        "relative min-w-0 rounded-2xl border bg-[#FFFCF4]/95 p-3 shadow-sm",
        match
          ? "border-[#EED8AA]/80"
          : "border-dashed border-[#EED8AA]/70 bg-[#FFF8E8]/60",
        center && "border-[#74B87A]/80 bg-[#F1FAEF]",
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-muted-foreground">
            {roundLabel(round)} · 第 {slot} 场
          </div>
        </div>
        {match?.contest ? (
          <Badge
            variant={match.contest.status === "voting" ? "love" : "outline"}
            className="max-w-[96px] shrink-0 whitespace-normal text-center leading-4"
          >
            {statusLabel[match.contest.status]}
          </Badge>
        ) : null}
      </div>

      <div className="space-y-2">
        <ParticipantRow
          participant={match?.left ?? null}
          resultVisible={resultVisible}
        />
        <ParticipantRow
          participant={match?.right ?? null}
          resultVisible={resultVisible}
        />
      </div>

      {match ? (
        <div className="mt-3">
          {match.contest && !match.resultVisible && match.contest.status === "closed" ? (
            <div className="rounded-xl border border-[#EED8AA]/70 bg-[#FFF8E8]/70 px-3 py-2 text-xs text-muted-foreground">
              结果待公开
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-[#EED8AA]/70 bg-white/50 px-3 py-2 text-center text-xs text-muted-foreground">
          等待上一轮结束后生成
        </div>
      )}
    </div>
  );
}

function MatchColumn({
  title,
  matches,
  center = false,
}: {
  title: string;
  matches: Array<{
    round: string;
    slot: number;
    match: TournamentBracketMatch | null;
  }>;
  center?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col justify-around gap-4">
      <div className="rounded-full border border-[#EED8AA]/70 bg-white/80 px-3 py-1 text-center text-sm font-medium text-[#5C321E]">
        {title}
      </div>
      <div className="flex flex-1 flex-col justify-around gap-4">
        {matches.map((item) => (
          <TopologyMatchNode
            key={`${item.round}-${item.slot}`}
            round={item.round}
            slot={item.slot}
            match={item.match}
            center={center}
          />
        ))}
      </div>
    </div>
  );
}

function MergeConnector({
  groups,
  direction,
}: {
  groups: number;
  direction: "right" | "left";
}) {
  return (
    <div className="flex w-12 flex-col justify-around py-12">
      {Array.from({ length: groups }, (_, index) => (
        <div key={index} className="relative min-h-[120px] flex-1">
          <span
            className={cn(
              "absolute top-[28%] border-t-4 border-[#9A6A35]",
              direction === "right" ? "left-0 right-1/2" : "left-1/2 right-0",
            )}
          />
          <span
            className={cn(
              "absolute bottom-[28%] border-t-4 border-[#9A6A35]",
              direction === "right" ? "left-0 right-1/2" : "left-1/2 right-0",
            )}
          />
          <span
            className={cn(
              "absolute bottom-[28%] top-[28%] border-l-4 border-[#9A6A35]",
              direction === "right" ? "right-1/2" : "left-1/2",
            )}
          />
          <span
            className={cn(
              "absolute top-1/2 border-t-4 border-[#9A6A35]",
              direction === "right" ? "left-1/2 right-0" : "left-0 right-1/2",
            )}
          />
        </div>
      ))}
    </div>
  );
}

function StraightConnector() {
  return (
    <div className="relative w-12 py-12">
      <span className="absolute left-0 right-0 top-1/2 border-t-4 border-[#9A6A35]" />
    </div>
  );
}

export function TournamentBracket({
  bracket,
}: {
  bracket: TournamentBracketData;
}) {
  if (bracket.rounds.length === 0) {
    return null;
  }

  const matches = matchByRoundSlot(bracket);
  const leftRoundOf16 = [1, 2, 3, 4].map((slot) => ({
    round: "round_of_16",
    slot,
    match: matches.get(`round_of_16:${slot}`) ?? null,
  }));
  const leftQuarterfinal = [1, 2].map((slot) => ({
    round: "quarterfinal",
    slot,
    match: matches.get(`quarterfinal:${slot}`) ?? null,
  }));
  const leftSemifinal = [
    {
      round: "semifinal",
      slot: 1,
      match: matches.get("semifinal:1") ?? null,
    },
  ];
  const finalMatches = [
    {
      round: "final",
      slot: 1,
      match: matches.get("final:1") ?? null,
    },
  ];
  const thirdPlace = matches.get("third_place:1");
  if (thirdPlace) {
    finalMatches.push({
      round: "third_place",
      slot: 1,
      match: thirdPlace,
    });
  }
  const rightSemifinal = [
    {
      round: "semifinal",
      slot: 2,
      match: matches.get("semifinal:2") ?? null,
    },
  ];
  const rightQuarterfinal = [3, 4].map((slot) => ({
    round: "quarterfinal",
    slot,
    match: matches.get(`quarterfinal:${slot}`) ?? null,
  }));
  const rightRoundOf16 = [5, 6, 7, 8].map((slot) => ({
    round: "round_of_16",
    slot,
    match: matches.get(`round_of_16:${slot}`) ?? null,
  }));

  return (
    <section className="w-full min-w-0 max-w-full overflow-hidden rounded-3xl border border-[#EED8AA]/70 bg-[#FFF8E8]/60 p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-[#EED8AA] bg-white/70 px-3 py-1 text-sm font-medium text-[#8A5525]">
            <Trophy className="size-4" />
            正赛对阵
          </div>
          <h2 className="mt-3 text-2xl font-semibold tracking-normal text-[#5C321E]">
            {bracket.tournament.name}
          </h2>
        </div>
        <Badge variant="secondary">{bracket.tournament.status}</Badge>
      </div>

      <div className="w-full min-w-0 overflow-hidden rounded-2xl border border-[#EED8AA]/60 bg-white/35">
        <div className="max-w-full overflow-x-auto overflow-y-hidden overscroll-x-contain pb-2">
          <div
            className="grid min-h-[620px] w-max max-w-none gap-0 p-4"
            style={{
              gridTemplateColumns:
                "280px 48px 280px 48px 280px 48px 320px 48px 280px 48px 280px 48px 280px",
            }}
          >
            <MatchColumn
              title="左半区 16 强"
              matches={leftRoundOf16}
            />
            <MergeConnector groups={2} direction="right" />
            <MatchColumn
              title="左半区 8 强"
              matches={leftQuarterfinal}
            />
            <MergeConnector groups={1} direction="right" />
            <MatchColumn
              title="左半区半决赛"
              matches={leftSemifinal}
            />
            <StraightConnector />
            <MatchColumn
              title="中心赛程"
              matches={finalMatches}
              center
            />
            <StraightConnector />
            <MatchColumn
              title="右半区半决赛"
              matches={rightSemifinal}
            />
            <MergeConnector groups={1} direction="left" />
            <MatchColumn
              title="右半区 8 强"
              matches={rightQuarterfinal}
            />
            <MergeConnector groups={2} direction="left" />
            <MatchColumn
              title="右半区 16 强"
              matches={rightRoundOf16}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
