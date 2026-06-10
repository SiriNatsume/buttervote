import { Trophy, UserRound } from "lucide-react";
import { getPublicImageUrl } from "@/lib/image/image-url";
import type {
  TournamentBracketData,
  TournamentBracketMatch,
  TournamentBracketParticipant,
} from "@/lib/tournament-bracket";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { TournamentBracketShareButton } from "@/components/tournament-bracket-share-button";

function ParticipantRow({
  participant,
  resultVisible,
}: {
  participant: TournamentBracketParticipant | null;
  resultVisible: boolean;
}) {
  if (!participant) {
    return (
      <div className="flex min-h-[78px] items-center rounded-xl border border-dashed border-[#EED8AA] bg-white/45 px-3 py-2 text-sm text-muted-foreground">
        待定
      </div>
    );
  }

  const imageUrl = getPublicImageUrl(participant.imagePath);

  return (
    <div
      className={cn(
        "flex min-h-[84px] items-center gap-3 rounded-xl border px-3 py-2.5",
        participant.isWinner && resultVisible
          ? "border-l-[5px] border-[#9ACF9E] border-l-[#3C8B4F] bg-[#F7FEF5]"
          : "border-[#EED8AA]/70 bg-white/75",
      )}
    >
      <div className="flex size-[52px] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#F7EAD0]">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={`${participant.name} 图片`}
            className="size-full object-cover"
          />
        ) : (
          <UserRound className="size-5 text-[#B9854C]" aria-hidden="true" />
        )}
      </div>
      <div className="flex min-h-[52px] min-w-0 flex-1 flex-col justify-center">
        <div className="break-words text-[16px] font-bold leading-[22px] text-[#3F2418]">
          {participant.name}
        </div>
        {participant.seedLabel ? (
          <div className="mt-1 break-words text-[11px] font-medium leading-[16px] text-[#7A6040]">
            {participant.seedLabel}
          </div>
        ) : null}
      </div>
      {resultVisible && participant.score !== null ? (
        <div
          className={cn(
            "flex h-[52px] w-12 shrink-0 flex-col items-center justify-center rounded-lg bg-white/75 px-1 text-center text-[16px] font-bold leading-5 text-[#5C321E]",
            participant.isWinner && "text-[#2F7A42]",
          )}
        >
          <div>{participant.score}</div>
          <div className="text-[10px] font-medium text-[#8A6A45]">票</div>
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

function matchStatusLabel(status: string) {
  const labels: Record<string, string> = {
    draft: "未开始",
    waiting: "等待开始",
    voting: "投票中",
    closed: "结果待公开",
  };

  return labels[status] ?? null;
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

function participantByEntryId(
  match: TournamentBracketMatch | null,
  entryId: string | null,
) {
  if (!match || !entryId) {
    return null;
  }

  return (
    [match.left, match.right].find(
      (participant) => participant?.entryId === entryId,
    ) ?? null
  );
}

function finalStandingRows(
  finalMatch: TournamentBracketMatch | null,
  thirdPlaceMatch: TournamentBracketMatch | null,
) {
  return [
    ["冠军", participantByEntryId(finalMatch, finalMatch?.winnerEntryId ?? null)],
    ["亚军", participantByEntryId(finalMatch, finalMatch?.loserEntryId ?? null)],
    [
      "季军",
      participantByEntryId(
        thirdPlaceMatch,
        thirdPlaceMatch?.winnerEntryId ?? null,
      ),
    ],
    [
      "第四名",
      participantByEntryId(
        thirdPlaceMatch,
        thirdPlaceMatch?.loserEntryId ?? null,
      ),
    ],
  ].filter(
    (row): row is [string, TournamentBracketParticipant] => row[1] !== null,
  );
}

function ChampionCard({
  champion,
  tournamentName,
}: {
  champion: TournamentBracketParticipant;
  tournamentName: string;
}) {
  const imageUrl = getPublicImageUrl(champion.imagePath);

  return (
    <div className="rounded-2xl border-2 border-[#F0C45C] bg-[#FFF4D8] px-4 pb-4 pt-3 text-center">
      <div className="mx-auto w-fit">
        <div
          className="mx-auto mb-1 text-[34px] font-bold leading-8 text-[#D6A539]"
          aria-hidden="true"
        >
          ♛
        </div>
        <div>
          <div className="flex size-24 items-center justify-center overflow-hidden rounded-2xl border-4 border-[#F0C45C] bg-white shadow-sm">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={`${champion.name} 图片`}
                className="size-full object-cover"
              />
            ) : (
              <Trophy className="size-9 text-[#B9854C]" aria-hidden="true" />
            )}
          </div>
        </div>
      </div>
      <div className="mt-3 text-xs font-bold text-[#B9854C]">冠军</div>
      <div className="mt-1 break-words text-[22px] font-bold leading-7 text-[#3F2418]">
        {champion.name}
      </div>
      <div className="mt-2 break-words text-[13px] font-bold leading-5 text-[#B9854C]">
        {tournamentName}冠军
      </div>
    </div>
  );
}

function FinalStandingPanel({
  rows,
}: {
  rows: Array<[string, TournamentBracketParticipant]>;
}) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-[#EED8AA]/80 bg-white/90 p-4">
      <div className="mb-3 text-[15px] font-bold leading-5 text-[#5C321E]">最终结果</div>
      <div className="space-y-2">
        {rows.map(([label, participant]) => (
          <div
            key={label}
            className="flex min-h-11 items-center gap-3 rounded-xl bg-[#FFF8E8]/85 px-3 py-2"
          >
            <span className="w-14 shrink-0 text-[13px] font-bold leading-5 text-[#B9854C]">
              {label}
            </span>
            <span className="min-w-0 flex-1 break-words text-[15px] font-semibold leading-5 text-[#3F2418]">
              {participant.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
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
  const statusText =
    match?.contest &&
    !["closed", "published"].includes(match.contest.status)
      ? matchStatusLabel(match.contest.status)
      : null;

  return (
    <div
      className={cn(
        "relative min-w-0 rounded-2xl border bg-[#FFFCF4] p-4",
        match
          ? "border-[#EED8AA]/80"
          : "border-dashed border-[#EED8AA]/70 bg-[#FFF8E8]/60",
        center && "border-[#74B87A]/80 bg-[#F1FAEF]",
      )}
    >
      <div className="mb-3 flex min-h-6 items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center">
          <div className="text-[12px] font-bold leading-5 text-[#7A6040]">
            {roundLabel(round)} · 第 {slot} 场
          </div>
        </div>
        {statusText ? (
          <Badge
            variant={match?.contest?.status === "voting" ? "love" : "outline"}
            className="inline-flex h-7 max-w-[112px] shrink-0 items-center justify-center whitespace-nowrap px-2.5 text-center leading-none"
          >
            {statusText}
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
  subtitle,
  matches,
  center = false,
  champion = null,
  tournamentName,
  standings = [],
}: {
  title: string;
  subtitle: string;
  matches: Array<{
    round: string;
    slot: number;
    match: TournamentBracketMatch | null;
  }>;
  center?: boolean;
  champion?: TournamentBracketParticipant | null;
  tournamentName?: string;
  standings?: Array<[string, TournamentBracketParticipant]>;
}) {
  return (
    <div className="flex min-w-0 flex-col justify-around gap-4">
      <div className="flex h-16 flex-col items-center justify-center rounded-2xl border border-[#EED8AA]/80 bg-white/90 px-3 text-center">
        <div className="text-lg font-bold leading-6 text-[#4A2B1B]">
          {title}
        </div>
        <div className="mt-0.5 text-[11px] font-medium leading-4 text-[#8A6A45]">
          {subtitle}
        </div>
      </div>
      <div
        className={cn(
          "flex flex-1 flex-col gap-4",
          center ? "justify-center" : "justify-around",
        )}
      >
        {champion && tournamentName ? (
          <>
            <ChampionCard champion={champion} tournamentName={tournamentName} />
            <div className="mx-auto h-7 border-l-[3px] border-[#65A96E]" />
          </>
        ) : null}
        {matches.map((item) => (
          <TopologyMatchNode
            key={`${item.round}-${item.slot}`}
            round={item.round}
            slot={item.slot}
            match={item.match}
            center={center}
          />
        ))}
        {center ? <FinalStandingPanel rows={standings} /> : null}
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
    <div className="flex w-9 flex-col justify-around py-12">
      {Array.from({ length: groups }, (_, index) => (
        <div key={index} className="relative min-h-[120px] flex-1">
          <span
            className={cn(
              "absolute top-[28%] border-t-2 border-[#D5B77A]/80",
              direction === "right" ? "left-0 right-1/2" : "left-1/2 right-0",
            )}
          />
          <span
            className={cn(
              "absolute bottom-[28%] border-t-2 border-[#D5B77A]/80",
              direction === "right" ? "left-0 right-1/2" : "left-1/2 right-0",
            )}
          />
          <span
            className={cn(
              "absolute bottom-[28%] top-[28%] border-l-2 border-[#D5B77A]/80",
              direction === "right" ? "right-1/2" : "left-1/2",
            )}
          />
          <span
            className={cn(
              "absolute top-1/2 border-t-2 border-[#D5B77A]/80",
              direction === "right" ? "left-1/2 right-0" : "left-0 right-1/2",
            )}
          />
        </div>
      ))}
    </div>
  );
}

function StraightConnector({ highlight = false }: { highlight?: boolean }) {
  return (
    <div className="relative w-9 py-12">
      <span
        className={cn(
          "absolute left-0 right-0 top-1/2 border-t-2",
          highlight ? "border-[#65A96E]" : "border-[#D5B77A]/80",
        )}
      />
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
  const finalMatch = matches.get("final:1") ?? null;
  const thirdPlace = matches.get("third_place:1") ?? null;
  const champion = championFromFinal(finalMatch);
  const standings = finalStandingRows(finalMatch, thirdPlace);
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
    <section
      className="w-full min-w-0 max-w-full overflow-hidden rounded-3xl border border-[#EED8AA]/70 bg-[#FFF8E8] p-3 shadow-sm sm:p-4"
      data-bracket-share-root
    >
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="break-words text-[26px] font-bold leading-[34px] tracking-normal text-[#4A2B1B]">
            {bracket.tournament.name}
          </h2>
          <div className="mt-5 flex flex-wrap items-center gap-2.5 text-xs font-medium leading-[14px] text-[#7A6040]">
            <span className="inline-flex h-7 items-center overflow-visible rounded-full border border-[#D7EBCB] bg-[#F4FBF1] px-3 pb-[4px] pt-[1px]">
              <span className="leading-[14px]">绿色左条 = 获胜</span>
            </span>
            <span className="inline-flex h-7 items-center overflow-visible rounded-full border border-[#EED8AA]/80 bg-white/80 px-3 pb-[4px] pt-[1px]">
              <span className="leading-[14px]">数字 = 得票数</span>
            </span>
            <span className="inline-flex h-7 items-center overflow-visible rounded-full border border-[#EED8AA]/80 bg-white/80 px-3 pb-[4px] pt-[1px]">
              <span className="leading-[14px]">两侧向中心晋级</span>
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <TournamentBracketShareButton bracket={bracket} />
        </div>
      </div>

      <div
        className="w-full min-w-0 overflow-hidden rounded-2xl border border-[#EED8AA]/60 bg-[#FFF8E8]"
        data-bracket-share-frame
      >
        <div
          className="max-w-full overflow-x-auto overflow-y-hidden overscroll-x-contain pb-2"
          data-bracket-share-scroll
        >
          <div
            className="grid min-h-[740px] w-max max-w-none gap-0 p-4"
            data-bracket-share-grid
            style={{
              gridTemplateColumns:
                "324px 36px 324px 36px 324px 36px 400px 36px 324px 36px 324px 36px 324px",
            }}
          >
            <MatchColumn
              title="16 强"
              subtitle="左半区 → 8 强"
              matches={leftRoundOf16}
            />
            <MergeConnector groups={2} direction="right" />
            <MatchColumn
              title="8 强"
              subtitle="左半区 → 半决赛"
              matches={leftQuarterfinal}
            />
            <MergeConnector groups={1} direction="right" />
            <MatchColumn
              title="半决赛"
              subtitle="左半区 → 冠军赛"
              matches={leftSemifinal}
            />
            <StraightConnector highlight />
            <MatchColumn
              title="决赛"
              subtitle="冠军赛 / 季军赛"
              matches={finalMatches}
              center
              champion={champion}
              tournamentName={bracket.tournament.name}
              standings={standings}
            />
            <StraightConnector highlight />
            <MatchColumn
              title="半决赛"
              subtitle="冠军赛 ← 右半区"
              matches={rightSemifinal}
            />
            <MergeConnector groups={1} direction="left" />
            <MatchColumn
              title="8 强"
              subtitle="半决赛 ← 右半区"
              matches={rightQuarterfinal}
            />
            <MergeConnector groups={2} direction="left" />
            <MatchColumn
              title="16 强"
              subtitle="8 强 ← 右半区"
              matches={rightRoundOf16}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
