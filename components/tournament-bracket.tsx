import { Trophy, UserRound } from "lucide-react";
import { getPublicImageUrl } from "@/lib/image/image-url";
import type {
  TournamentBracketData,
  TournamentBracketMatch,
  TournamentBracketParticipant,
} from "@/lib/tournament-bracket";
import { cn } from "@/lib/utils";
import { MascotEmptyState } from "@/components/mascot";
import {
  TournamentMatchTooltip,
  type TournamentMatchTooltipData,
} from "@/components/tournament-match-tooltip";
import { TournamentBracketShareButton } from "@/components/tournament-bracket-share-button";

const ROUND_COLUMNS = [
  { round: "round_of_16", title: "16 强", count: 8, span: 1 },
  { round: "quarterfinal", title: "8 强", count: 4, span: 2 },
  { round: "semifinal", title: "半决赛", count: 2, span: 4 },
] as const;

function matchByRoundSlot(bracket: TournamentBracketData) {
  const matches = new Map<string, TournamentBracketMatch>();
  for (const round of bracket.rounds) {
    for (const match of round.matches) {
      matches.set(`${match.round}:${match.slot}`, match);
    }
  }
  return matches;
}

function championFromFinal(match: TournamentBracketMatch | null) {
  if (!match?.resultVisible || !match.winnerEntryId) {
    return null;
  }

  return (
    [match.left, match.right].find(
      (participant) => participant?.entryId === match.winnerEntryId,
    ) ?? null
  );
}

function ParticipantRow({
  participant,
  resultVisible,
}: {
  participant: TournamentBracketParticipant | null;
  resultVisible: boolean;
}) {
  const imageUrl = participant ? getPublicImageUrl(participant.imagePath) : null;

  return (
    <div
      className={cn(
        "relative flex h-8 min-w-0 items-center overflow-hidden px-2",
        participant?.isWinner && resultVisible
          ? "bg-[#F7FEF5]"
          : "bg-transparent",
      )}
    >
      {imageUrl && participant ? (
        <img
          src={imageUrl}
          alt=""
          className={cn(
            "pointer-events-none absolute inset-y-0 left-0 h-full w-16 object-cover object-center",
            resultVisible && !participant.isWinner
              ? "opacity-60 grayscale"
              : "opacity-70",
          )}
          style={{
            maskImage: "linear-gradient(to right, black 0%, black 36%, transparent 100%)",
            WebkitMaskImage:
              "linear-gradient(to right, black 0%, black 36%, transparent 100%)",
          }}
          aria-hidden="true"
        />
      ) : (
        <UserRound
          className="pointer-events-none absolute left-2 size-3.5 text-[#B9854C]/70"
          aria-hidden="true"
        />
      )}
      <span
        className={cn(
          "relative z-[1] min-w-0 flex-1 truncate pl-5 pr-2 text-right text-[13px] leading-4 text-[#3F2418]",
          participant?.isWinner && resultVisible ? "font-bold" : "font-medium",
          !participant && "text-muted-foreground",
        )}
        title={participant?.name}
      >
        {participant?.name ?? "待定"}
      </span>
      {participant && resultVisible && participant.score !== null ? (
        <span
          className={cn(
            "relative z-[1] -mr-px flex h-7 min-w-7 shrink-0 items-center justify-center rounded-[3px] border border-[#D2D2D2] bg-[#ECECEC] px-1 text-center text-xs font-bold tabular-nums text-[#2F2F2F]",
            participant.isWinner &&
              "border-[#2F7540] bg-[#3C8B4F] text-white",
          )}
          aria-label={`${participant.score} 票`}
        >
          {participant.score}
        </span>
      ) : null}
    </div>
  );
}

function MatchNode({ match }: { match: TournamentBracketMatch | null }) {
  const content = (
    <div
      className={cn(
        "overflow-hidden rounded-[3px] border bg-white/90 shadow-sm transition-colors",
        match
          ? "border-[#DCC89D]"
          : "border-dashed border-[#DCC89D]/80 bg-white/55",
        match?.contest && "hover:border-[#B9854C] hover:bg-white",
        match?.contest?.status === "voting" && "bracket-live-match-cell",
      )}
    >
      <ParticipantRow
        participant={match?.left ?? null}
        resultVisible={match?.resultVisible ?? false}
      />
      <div className="border-t border-[#E8DCC3]" />
      <ParticipantRow
        participant={match?.right ?? null}
        resultVisible={match?.resultVisible ?? false}
      />
    </div>
  );

  if (!match?.contest) {
    return content;
  }

  const tooltipData: TournamentMatchTooltipData = {
    contestId: match.contest.id,
    contestTitle: match.contest.title,
    status: match.contest.status,
    scheduledStartsAt: match.scheduledStartsAt,
    scheduledEndsAt: match.scheduledEndsAt,
    resultVisible: match.resultVisible,
    loveVoteWeight: match.loveVoteWeight,
    tiebreakExplanation: match.tiebreakExplanation,
    left: match.left
      ? {
          name: match.left.name,
          imageUrl: getPublicImageUrl(match.left.imagePath),
          score: match.left.score,
          normalScore: match.left.normalScore,
          loveScore: match.left.loveScore,
          loveVoteCount: match.left.loveVoteCount,
          isWinner: match.left.isWinner,
        }
      : null,
    right: match.right
      ? {
          name: match.right.name,
          imageUrl: getPublicImageUrl(match.right.imagePath),
          score: match.right.score,
          normalScore: match.right.normalScore,
          loveScore: match.right.loveScore,
          loveVoteCount: match.right.loveVoteCount,
          isWinner: match.right.isWinner,
        }
      : null,
  };

  return (
    <TournamentMatchTooltip data={tooltipData}>
      {content}
    </TournamentMatchTooltip>
  );
}

function StageHeader({
  title,
  column,
}: {
  title: string;
  column: number;
}) {
  return (
    <div
      className="snap-start rounded-md border border-[#E1CCA0] bg-white/90 px-3 py-2 text-center text-sm font-bold leading-5 text-[#4A2B1B]"
      style={{ gridColumn: column, gridRow: 1 }}
    >
      {title}
    </div>
  );
}

function RoundNodes({
  round,
  count,
  span,
  column,
  matches,
}: {
  round: string;
  count: number;
  span: number;
  column: number;
  matches: Map<string, TournamentBracketMatch>;
}) {
  return Array.from({ length: count }, (_, index) => {
    const slot = index + 1;
    const row = 2 + index * span;
    return (
      <div
        key={`${round}:${slot}`}
        className="min-w-0 self-center"
        style={{ gridColumn: column, gridRow: `${row} / span ${span}` }}
      >
        <MatchNode match={matches.get(`${round}:${slot}`) ?? null} />
      </div>
    );
  });
}

function MergeConnector({
  column,
  startRow,
  span,
}: {
  column: number;
  startRow: number;
  span: number;
}) {
  return (
    <div
      className="relative min-w-0"
      style={{ gridColumn: column, gridRow: `${startRow} / span ${span}` }}
      aria-hidden="true"
    >
      <span className="absolute left-0 right-1/2 top-1/4 border-t-2 border-[#D5B77A]/80" />
      <span
        className="absolute left-1/2 top-1/4 border-l-2 border-[#D5B77A]/80"
        style={{ bottom: "calc(50% + 16px)" }}
      />
      <span
        className="absolute left-1/2 right-0 border-t-2 border-[#D5B77A]/80"
        style={{ top: "calc(50% - 16px)" }}
      />

      <span className="absolute left-0 right-1/2 top-3/4 border-t-2 border-[#D5B77A]/80" />
      <span
        className="absolute bottom-1/4 left-1/2 border-l-2 border-[#D5B77A]/80"
        style={{ top: "calc(50% + 16px)" }}
      />
      <span
        className="absolute left-1/2 right-0 border-t-2 border-[#D5B77A]/80"
        style={{ top: "calc(50% + 16px)" }}
      />
    </div>
  );
}

function ChampionCard({ champion }: { champion: TournamentBracketParticipant }) {
  const imageUrl = getPublicImageUrl(champion.imagePath);

  return (
    <div className="mb-3 rounded-lg border-2 border-[#F0C45C] bg-[#FFF4D8] p-2 text-center shadow-sm">
      <div className="mb-1 flex items-center justify-center gap-2 text-[11px] font-bold text-[#B9854C]">
        <Trophy className="size-3.5" aria-hidden="true" />
        冠军
      </div>
      <div className="flex min-w-0 items-center justify-center gap-2">
        <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md border-2 border-[#F0C45C] bg-white">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={`${champion.name} 图片`}
              className="size-full object-cover"
            />
          ) : (
            <Trophy className="size-4 text-[#B9854C]" aria-hidden="true" />
          )}
        </div>
        <span className="min-w-0 truncate text-sm font-bold text-[#3F2418]" title={champion.name}>
          {champion.name}
        </span>
      </div>
    </div>
  );
}

function FinalColumn({
  finalMatch,
  thirdPlaceMatch,
  champion,
}: {
  finalMatch: TournamentBracketMatch | null;
  thirdPlaceMatch: TournamentBracketMatch | null;
  champion: TournamentBracketParticipant | null;
}) {
  return (
    <div
      className="grid min-w-0 grid-rows-[1fr_auto_1fr]"
      style={{ gridColumn: 7, gridRow: "2 / span 8" }}
    >
      <div className="flex min-h-0 flex-col justify-end">
        {champion ? <ChampionCard champion={champion} /> : null}
      </div>
      <MatchNode match={finalMatch} />
      <div className="flex min-h-0 flex-col justify-start pt-8">
        <div className="mb-2 rounded-md border border-[#E1CCA0] bg-white/90 px-3 py-1.5 text-center text-xs font-bold text-[#4A2B1B]">
          季军赛
        </div>
        <MatchNode match={thirdPlaceMatch} />
      </div>
    </div>
  );
}

export function TournamentBracket({
  bracket,
}: {
  bracket: TournamentBracketData;
}) {
  if (bracket.rounds.length === 0) {
    return (
      <MascotEmptyState
        kind="bracketNotReady"
        title={`${bracket.tournament.name} 的赛程图还没准备好`}
      >
        等待赛事抽签或上一轮结果生成后，对阵图会显示在这里。
      </MascotEmptyState>
    );
  }

  const matches = matchByRoundSlot(bracket);
  const finalMatch = matches.get("final:1") ?? null;
  const thirdPlaceMatch = matches.get("third_place:1") ?? null;
  const champion = championFromFinal(finalMatch);

  return (
    <section
      className="w-full min-w-0 max-w-full overflow-hidden rounded-3xl border border-[#EED8AA]/70 bg-[#FFF8E8] p-3 shadow-sm sm:p-4"
      data-bracket-share-root
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="min-w-0 truncate text-xl font-bold leading-7 text-[#4A2B1B] sm:text-2xl">
          {bracket.tournament.name}
        </h2>
        <div className="shrink-0">
          <TournamentBracketShareButton bracket={bracket} />
        </div>
      </div>

      <div
        className="w-full min-w-0 overflow-hidden rounded-2xl border border-[#EED8AA]/60 bg-[#FFF8E8]"
        data-bracket-share-frame
      >
        <div
          className="max-w-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain"
          data-bracket-share-scroll
        >
          <div
            className="grid w-max max-w-none gap-x-0 gap-y-2 p-3 sm:p-4"
            data-bracket-share-grid
            style={{
              gridTemplateColumns: "232px 28px 232px 28px 232px 28px 232px",
              gridTemplateRows: "36px repeat(8, 64px)",
            }}
          >
            {ROUND_COLUMNS.map((round, index) => {
              const column = index * 2 + 1;
              return (
                <StageHeader key={round.round} title={round.title} column={column} />
              );
            })}
            <StageHeader title="决赛" column={7} />

            {ROUND_COLUMNS.map((round, index) => (
              <RoundNodes
                key={round.round}
                round={round.round}
                count={round.count}
                span={round.span}
                column={index * 2 + 1}
                matches={matches}
              />
            ))}

            {Array.from({ length: 4 }, (_, index) => (
              <MergeConnector
                key={`ro16:${index}`}
                column={2}
                startRow={2 + index * 2}
                span={2}
              />
            ))}
            {Array.from({ length: 2 }, (_, index) => (
              <MergeConnector
                key={`quarterfinal:${index}`}
                column={4}
                startRow={2 + index * 4}
                span={4}
              />
            ))}
            <MergeConnector column={6} startRow={2} span={8} />

            <FinalColumn
              finalMatch={finalMatch}
              thirdPlaceMatch={thirdPlaceMatch}
              champion={champion}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
