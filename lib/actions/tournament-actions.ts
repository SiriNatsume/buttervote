"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActionAdmin } from "@/lib/auth";
import { toUserFacingError } from "@/lib/action-error";
import {
  buildKnockoutBracket,
  buildPreliminaryPools,
  drawPreliminaryGroups,
  reconcilePreliminaryAdvancerIds,
  resolveKnockoutMatch,
  resolvePreliminaryGroup,
  resolveScreeningAdvancers,
  resolveTiebreaker,
  type PreliminaryGroupKey,
  type PreliminaryGroupResolution,
} from "@/lib/tournament-rules";
import { createRequiredServiceClient } from "@/lib/supabase/service";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { tallyVotes, type TallyResult } from "@/lib/tally";
import type {
  Json,
  LoveVoteAllocation,
  TournamentEntry,
  TournamentMatch,
  TournamentStage,
  Vote,
} from "@/lib/types";

type ActionResult<T extends Record<string, unknown> = Record<string, unknown>> =
  | ({ ok: true; message?: string } & T)
  | { ok: false; error: string };

type ResultCandidate = {
  id: string;
  name: string;
  description: string | null;
  image_path: string | null;
  nominator_display_name: string | null;
  is_active: boolean;
  inherited_from_candidate_id: string | null;
  created_at: string;
};

type ContestResultBundle = {
  contest: {
    id: string;
    title: string;
    status: string;
    vote_type: "single" | "multiple" | "ranked";
    group_id: string | null;
    archived_at: string | null;
  };
  candidates: ResultCandidate[];
  results: TallyResult[];
};

type PreliminaryResolutionBundle = {
  group: PreliminaryGroupKey;
  stage: TournamentStage;
  contest: ContestResultBundle["contest"];
  candidates: ResultCandidate[];
  results: TallyResult[];
  resolution: PreliminaryGroupResolution<TallyResult>;
};

type KnockoutEntrySeed = {
  candidateId: string;
  entryId: string;
  currentCandidateId: string;
  preliminaryGroup: PreliminaryGroupKey;
  preliminaryRank: number;
  isGroupWinner: boolean;
  score: number;
  lastVoteAt: string | null;
  name: string;
};

type KnockoutRound =
  | "round_of_16"
  | "quarterfinal"
  | "semifinal"
  | "final"
  | "third_place";
type TerminalKnockoutRound = Extract<KnockoutRound, "final" | "third_place">;

type KnockoutMatchResolutionPayload = {
  matchId: string;
  slot: number;
  winnerEntryId: string;
  loserEntryId: string;
  winnerCandidateId: string;
  loserCandidateId: string;
};

type TiebreakerTieKind = "group_first" | "advancement";

const createTournamentSchema = z.object({
  name: z.string().trim().min(1, "赛事名称不能为空").max(160),
  screeningContestId: z.string().uuid("请选择海选活动"),
});

const generatePreliminarySchema = z.object({
  tournamentId: z.string().uuid(),
  targetGroupId: z.string().uuid().nullable(),
  seed: z.string().trim().max(160).optional(),
});

const generateFollowupStageSchema = z.object({
  tournamentId: z.string().uuid(),
  targetGroupId: z.string().uuid().nullable(),
  seed: z.string().trim().max(160).optional(),
});

function actionSuccess<T extends Record<string, unknown> = Record<string, unknown>>(
  message?: string,
  extra?: T,
): ActionResult<T> {
  return { ok: true, ...(message ? { message } : {}), ...(extra ?? ({} as T)) };
}

function actionFailure(message: string): { ok: false; error: string } {
  return { ok: false, error: toUserFacingError(message) };
}

function optionalUuidFromForm(value: FormDataEntryValue | null) {
  const text = String(value ?? "");
  return text && text !== "none" ? text : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonString(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function extractStringArray(value: unknown, key: string) {
  if (!isRecord(value)) {
    return [];
  }

  const rawValue = value[key];
  return Array.isArray(rawValue)
    ? rawValue.filter((item): item is string => typeof item === "string")
    : [];
}

async function getContestResults(contestId: string) {
  const supabase = createRequiredServiceClient();
  const { data: contest, error: contestError } = await supabase
    .from("contests")
    .select("id,title,status,vote_type,group_id,archived_at")
    .eq("id", contestId)
    .maybeSingle();

  if (contestError || !contest) {
    return {
      ok: false as const,
      error: contestError?.message ?? "活动不存在。",
    };
  }

  if (contest.archived_at) {
    return {
      ok: false as const,
      error: "活动已归档，不能作为赛制结果来源。",
    };
  }

  const [
    { data: candidates, error: candidatesError },
    { data: votes, error: votesError },
    { data: group },
    { data: loveRows, error: loveRowsError },
  ] = await Promise.all([
    supabase
      .from("candidates")
      .select(
        "id,name,description,image_path,nominator_display_name,is_active,inherited_from_candidate_id,created_at",
      )
      .eq("contest_id", contestId)
      .eq("is_active", true)
      .order("created_at", { ascending: true }),
    fetchAllRows<Vote>(() =>
      supabase
        .from("votes")
        .select("id,contest_id,voter_id,payload,created_at")
        .eq("contest_id", contestId)
        .order("created_at", { ascending: true }),
    ),
    contest.group_id
      ? supabase
          .from("contest_groups")
          .select("id,love_vote_weight")
          .eq("id", contest.group_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    contest.group_id
      ? fetchAllRows<Pick<LoveVoteAllocation, "vote_id" | "candidate_id">>(() =>
          supabase
            .from("love_vote_allocations")
            .select("vote_id,candidate_id")
            .eq("contest_id", contestId),
        )
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (candidatesError || votesError || loveRowsError) {
    return {
      ok: false as const,
      error:
        candidatesError?.message ??
        votesError?.message ??
        loveRowsError?.message ??
        "读取海选结果失败。",
    };
  }

  const results = tallyVotes({
    voteType: contest.vote_type,
    candidates: candidates ?? [],
    votes: votes ?? [],
    loveVoteWeight: group ? Number(group.love_vote_weight) : null,
    loveAllocations:
      (loveRows ?? []) as Array<
        Pick<LoveVoteAllocation, "vote_id" | "candidate_id">
      >,
  });

  return {
    ok: true as const,
    contest,
    candidates: (candidates ?? []) as ResultCandidate[],
    results,
  };
}

function toCandidatePayload(result: TallyResult) {
  return {
    candidateId: result.candidateId,
    name: result.name,
    score: result.score,
    lastVoteAt: result.lastVoteAt,
    rank: result.rank,
    position: result.position,
  };
}

function stagePreliminaryGroup(stage: Pick<TournamentStage, "metadata">) {
  const metadata = isRecord(stage.metadata) ? stage.metadata : {};
  const group = metadata.preliminaryGroup;
  return group === "A" || group === "B" || group === "C" || group === "D"
    ? group
    : null;
}

function stageTieKind(stage: Pick<TournamentStage, "metadata">) {
  const metadata = isRecord(stage.metadata) ? stage.metadata : {};
  const tieKind = metadata.tieKind;
  return tieKind === "group_first" || tieKind === "advancement"
    ? tieKind
    : null;
}

function stageHasLegacyTie(
  stage: Pick<TournamentStage, "metadata">,
  tieKind: TiebreakerTieKind,
) {
  const metadata = isRecord(stage.metadata) ? stage.metadata : {};
  if (stageTieKind(stage)) {
    return false;
  }

  return tieKind === "group_first"
    ? Boolean(metadata.groupFirstTie)
    : Boolean(metadata.advancementTie);
}

async function filterActiveStages(stages: TournamentStage[]) {
  const contestIds = [
    ...new Set(
      stages
        .map((stage) => stage.contest_id)
        .filter((contestId): contestId is string => Boolean(contestId)),
    ),
  ];

  if (contestIds.length === 0) {
    return [];
  }

  const supabase = createRequiredServiceClient();
  const { data: contests, error } = await supabase
    .from("contests")
    .select("id,archived_at")
    .in("id", contestIds);

  if (error) {
    throw new Error(error.message);
  }

  const activeContestIds = new Set(
    (contests ?? [])
      .filter((contest) => !contest.archived_at)
      .map((contest) => contest.id),
  );

  return stages.filter(
    (stage) => stage.contest_id && activeContestIds.has(stage.contest_id),
  );
}

async function hasActiveTournamentStage(
  tournamentId: string,
  kind: TournamentStage["kind"],
) {
  const supabase = createRequiredServiceClient();
  const { data, error } = await supabase
    .from("tournament_stages")
    .select("*")
    .eq("tournament_id", tournamentId)
    .eq("kind", kind);

  if (error) {
    throw new Error(error.message);
  }

  return (await filterActiveStages((data ?? []) as TournamentStage[])).length > 0;
}

async function getActiveTournamentStages(
  tournamentId: string,
  kind: TournamentStage["kind"],
) {
  const supabase = createRequiredServiceClient();
  const { data, error } = await supabase
    .from("tournament_stages")
    .select("*")
    .eq("tournament_id", tournamentId)
    .eq("kind", kind)
    .order("sequence", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return filterActiveStages((data ?? []) as TournamentStage[]);
}

async function filterActiveMatches(matches: TournamentMatch[]) {
  const contestIds = [
    ...new Set(
      matches
        .map((match) => match.contest_id)
        .filter((contestId): contestId is string => Boolean(contestId)),
    ),
  ];

  if (contestIds.length === 0) {
    return [];
  }

  const supabase = createRequiredServiceClient();
  const { data: contests, error } = await supabase
    .from("contests")
    .select("id,archived_at")
    .in("id", contestIds);

  if (error) {
    throw new Error(error.message);
  }

  const activeContestIds = new Set(
    (contests ?? [])
      .filter((contest) => !contest.archived_at)
      .map((contest) => contest.id),
  );

  return matches.filter(
    (match) => match.contest_id && activeContestIds.has(match.contest_id),
  );
}

function entryMapByCandidateId(entries: TournamentEntry[]) {
  const map = new Map<string, TournamentEntry>();

  for (const entry of entries) {
    for (const candidateId of [
      entry.current_candidate_id,
      entry.source_candidate_id,
      entry.root_candidate_id,
    ]) {
      if (candidateId) {
        map.set(candidateId, entry);
      }
    }
  }

  return map;
}

function preliminaryRankByCandidate(entries: TournamentEntry[]) {
  const ranks = new Map<string, number>();

  for (const entry of entries) {
    if (typeof entry.screening_rank !== "number") {
      continue;
    }

    for (const candidateId of [
      entry.current_candidate_id,
      entry.source_candidate_id,
      entry.root_candidate_id,
    ]) {
      if (candidateId) {
        ranks.set(candidateId, entry.screening_rank);
      }
    }
  }

  return ranks;
}

async function getTournamentEntries(tournamentId: string) {
  const supabase = createRequiredServiceClient();
  const { data, error } = await supabase
    .from("tournament_entries")
    .select(
      "id,tournament_id,root_candidate_id,current_candidate_id,source_candidate_id,screening_rank,preliminary_group,preliminary_rank,is_group_winner,status,created_at,updated_at",
    )
    .eq("tournament_id", tournamentId);

  if (error) {
    return { ok: false as const, error: error.message };
  }

  return { ok: true as const, entries: (data ?? []) as TournamentEntry[] };
}

async function getPreliminaryResolutionBundles(
  tournamentId: string,
): Promise<
  | { ok: true; bundles: PreliminaryResolutionBundle[]; entries: TournamentEntry[] }
  | { ok: false; error: string }
> {
  const supabase = createRequiredServiceClient();
  const [{ data: stages, error: stagesError }, entriesResult] =
    await Promise.all([
      supabase
        .from("tournament_stages")
        .select("*")
        .eq("tournament_id", tournamentId)
        .eq("kind", "preliminary")
        .order("sequence", { ascending: true }),
      getTournamentEntries(tournamentId),
    ]);

  if (stagesError) {
    return { ok: false, error: stagesError.message };
  }

  if (!entriesResult.ok) {
    return entriesResult;
  }

  const preliminaryStages = (stages ?? []) as TournamentStage[];
  if (preliminaryStages.length === 0) {
    return { ok: false, error: "请先生成预赛。" };
  }

  const rankLookup = preliminaryRankByCandidate(entriesResult.entries);
  const bundles: PreliminaryResolutionBundle[] = [];

  for (const stage of preliminaryStages) {
    const group = stagePreliminaryGroup(stage);
    if (!group || !stage.contest_id) {
      return { ok: false, error: "预赛阶段数据不完整。" };
    }

    const contestResults = await getContestResults(stage.contest_id);
    if (!contestResults.ok) {
      return { ok: false, error: contestResults.error };
    }

    bundles.push({
      group,
      stage,
      contest: contestResults.contest,
      candidates: contestResults.candidates,
      results: contestResults.results,
      resolution: resolvePreliminaryGroup(contestResults.results, rankLookup),
    });
  }

  return { ok: true, bundles, entries: entriesResult.entries };
}

function toSourceTiebreakerResults(
  bundle: ContestResultBundle,
): Array<TallyResult & { tiebreakerCandidateId: string }> {
  const sourceByCandidateId = new Map(
    bundle.candidates.map((candidate) => [
      candidate.id,
      candidate.inherited_from_candidate_id ?? candidate.id,
    ]),
  );

  return bundle.results.map((result) => ({
    ...result,
    tiebreakerCandidateId: result.candidateId,
    candidateId: sourceByCandidateId.get(result.candidateId) ?? result.candidateId,
  }));
}

function resultByCandidateId(results: TallyResult[]) {
  return new Map(results.map((result) => [result.candidateId, result]));
}

function uniqueCandidateIds(candidateIds: string[]) {
  return [...new Set(candidateIds.filter(Boolean))];
}

function resolveExpectedTiebreakerCandidates(params: {
  results: TallyResult[];
  expectedCandidateIds: string[];
  slots: number;
  seed: string;
  label: string;
}) {
  const expectedCandidateIds = uniqueCandidateIds(params.expectedCandidateIds);
  const expectedCandidateIdSet = new Set(expectedCandidateIds);
  const scopedResults = params.results.filter((result) =>
    expectedCandidateIdSet.has(result.candidateId),
  );
  const presentCandidateIds = new Set(
    scopedResults.map((result) => result.candidateId),
  );
  const missingCandidateIds = expectedCandidateIds.filter(
    (candidateId) => !presentCandidateIds.has(candidateId),
  );

  if (missingCandidateIds.length > 0) {
    return {
      ok: false as const,
      error: `${params.label}加赛候选映射不完整，请检查加赛是否由赛制工具生成。`,
    };
  }

  const resolution = resolveTiebreaker(
    scopedResults,
    params.slots,
    params.seed,
  );

  if (resolution.selected.length < Math.min(params.slots, scopedResults.length)) {
    return {
      ok: false as const,
      error: `${params.label}加赛结果不足，请先结束加赛并确认候选有效。`,
    };
  }

  return { ok: true as const, resolution };
}

function assertClosedContest(contest: Pick<ContestResultBundle["contest"], "status">) {
  return ["closed", "published"].includes(contest.status);
}

function normalizeKnockoutRound(value: unknown): KnockoutRound | null {
  return value === "round_of_16" ||
    value === "quarterfinal" ||
    value === "semifinal" ||
    value === "final" ||
    value === "third_place"
    ? value
    : null;
}

function knockoutRoundLabel(round: KnockoutRound) {
  switch (round) {
    case "round_of_16":
      return "16 强";
    case "quarterfinal":
      return "8 强";
    case "semifinal":
      return "半决赛";
    case "final":
      return "冠军赛";
    case "third_place":
      return "季军赛";
  }
}

function getSameGroupHeadToHeadWinner(
  leftEntry: TournamentEntry,
  rightEntry: TournamentEntry,
  candidateIdByEntryId: ReadonlyMap<string, string>,
) {
  if (
    !leftEntry.preliminary_group ||
    leftEntry.preliminary_group !== rightEntry.preliminary_group ||
    typeof leftEntry.preliminary_rank !== "number" ||
    typeof rightEntry.preliminary_rank !== "number" ||
    leftEntry.preliminary_rank === rightEntry.preliminary_rank
  ) {
    return null;
  }

  const winnerEntry =
    leftEntry.preliminary_rank < rightEntry.preliminary_rank
      ? leftEntry
      : rightEntry;
  return candidateIdByEntryId.get(winnerEntry.id) ?? null;
}

function planNextKnockoutRound(matches: TournamentMatch[]) {
  const rounds = new Set(
    matches
      .map((match) => normalizeKnockoutRound(match.round))
      .filter((round): round is KnockoutRound => Boolean(round)),
  );

  if (!rounds.has("round_of_16")) {
    return { ok: false as const, error: "请先生成正赛 16 强。" };
  }

  if (!rounds.has("quarterfinal")) {
    return {
      ok: true as const,
      sourceRound: "round_of_16" as const,
      expectedSourceCount: 8,
      targetMatches: [
        { round: "quarterfinal" as const, slot: 1, sourceSlots: [1, 2] },
        { round: "quarterfinal" as const, slot: 2, sourceSlots: [3, 4] },
        { round: "quarterfinal" as const, slot: 3, sourceSlots: [5, 6] },
        { round: "quarterfinal" as const, slot: 4, sourceSlots: [7, 8] },
      ],
    };
  }

  if (!rounds.has("semifinal")) {
    return {
      ok: true as const,
      sourceRound: "quarterfinal" as const,
      expectedSourceCount: 4,
      targetMatches: [
        { round: "semifinal" as const, slot: 1, sourceSlots: [1, 2] },
        { round: "semifinal" as const, slot: 2, sourceSlots: [3, 4] },
      ],
    };
  }

  if (!rounds.has("final") && !rounds.has("third_place")) {
    return {
      ok: true as const,
      sourceRound: "semifinal" as const,
      expectedSourceCount: 2,
      targetMatches: [
        {
          round: "final" as const,
          slot: 1,
          sourceSlots: [1, 2],
          participant: "winner" as const,
        },
        {
          round: "third_place" as const,
          slot: 1,
          sourceSlots: [1, 2],
          participant: "loser" as const,
        },
      ],
    };
  }

  return { ok: false as const, error: "正赛 contest 已全部生成。" };
}

async function resolveKnockoutSourceMatches(
  tournamentId: string,
  sourceRound: KnockoutRound,
  expectedCount: number,
  seed: string,
): Promise<
  | {
      ok: true;
      matches: TournamentMatch[];
      resolutions: KnockoutMatchResolutionPayload[];
    }
  | { ok: false; error: string }
> {
  const supabase = createRequiredServiceClient();
  const [{ data: matches, error: matchesError }, entriesResult] =
    await Promise.all([
      supabase
        .from("tournament_matches")
        .select(
          "id,tournament_id,stage_id,contest_id,round,slot,left_entry_id,right_entry_id,winner_entry_id,loser_entry_id,metadata,created_at,updated_at",
        )
        .eq("tournament_id", tournamentId)
        .eq("round", sourceRound)
        .order("slot", { ascending: true }),
      getTournamentEntries(tournamentId),
    ]);

  if (matchesError) {
    return { ok: false, error: matchesError.message };
  }
  if (!entriesResult.ok) {
    return entriesResult;
  }

  const sourceMatches = await filterActiveMatches((matches ?? []) as TournamentMatch[]);
  if (sourceMatches.length !== expectedCount) {
    return {
      ok: false,
      error: `${knockoutRoundLabel(sourceRound)} 数据不完整。`,
    };
  }

  const entryById = new Map(entriesResult.entries.map((entry) => [entry.id, entry]));
  const resolutions: KnockoutMatchResolutionPayload[] = [];

  for (const match of sourceMatches) {
    if (match.winner_entry_id && match.loser_entry_id) {
      resolutions.push({
        matchId: match.id,
        slot: match.slot,
        winnerEntryId: match.winner_entry_id,
        loserEntryId: match.loser_entry_id,
        winnerCandidateId: match.winner_entry_id,
        loserCandidateId: match.loser_entry_id,
      });
      continue;
    }

    if (!match.contest_id || !match.left_entry_id || !match.right_entry_id) {
      return {
        ok: false,
        error: `${knockoutRoundLabel(sourceRound)} 第 ${match.slot} 场数据不完整。`,
      };
    }

    const leftEntry = entryById.get(match.left_entry_id);
    const rightEntry = entryById.get(match.right_entry_id);
    if (
      !leftEntry?.current_candidate_id ||
      !rightEntry?.current_candidate_id
    ) {
      return {
        ok: false,
        error: `${knockoutRoundLabel(sourceRound)} 第 ${match.slot} 场选手数据不完整。`,
      };
    }

    const contestResults = await getContestResults(match.contest_id);
    if (!contestResults.ok) {
      return { ok: false, error: contestResults.error };
    }
    if (!assertClosedContest(contestResults.contest)) {
      return {
        ok: false,
        error: `${knockoutRoundLabel(sourceRound)} 第 ${match.slot} 场尚未结束。`,
      };
    }

    const entryIdByCandidateId = new Map<string, string>();
    for (const candidate of contestResults.candidates) {
      if (
        candidate.id === leftEntry.current_candidate_id ||
        candidate.inherited_from_candidate_id === leftEntry.current_candidate_id
      ) {
        entryIdByCandidateId.set(candidate.id, leftEntry.id);
      }
      if (
        candidate.id === rightEntry.current_candidate_id ||
        candidate.inherited_from_candidate_id === rightEntry.current_candidate_id
      ) {
        entryIdByCandidateId.set(candidate.id, rightEntry.id);
      }
    }

    const candidateIdByEntryId = new Map(
      Array.from(entryIdByCandidateId.entries()).map(([candidateId, entryId]) => [
        entryId,
        candidateId,
      ]),
    );
    const matchResults = contestResults.results
      .map((result) => {
        const entryId = entryIdByCandidateId.get(result.candidateId);
        return entryId ? { ...result, entryId } : null;
      })
      .filter(
        (result): result is TallyResult & { entryId: string } =>
          result !== null,
      );

    if (matchResults.length !== 2) {
      return {
        ok: false,
        error: `${knockoutRoundLabel(sourceRound)} 第 ${match.slot} 场候选映射不完整。`,
      };
    }

    const screeningRankByCandidate = new Map<string, number>();
    for (const result of matchResults) {
      const entry = entryById.get(result.entryId);
      if (typeof entry?.screening_rank === "number") {
        screeningRankByCandidate.set(result.candidateId, entry.screening_rank);
      }
    }

    const headToHeadWinnerId = getSameGroupHeadToHeadWinner(
      leftEntry,
      rightEntry,
      candidateIdByEntryId,
    );
    const resolution = resolveKnockoutMatch(matchResults, {
      headToHeadWinnerId,
      screeningRankByCandidate,
      seed: `${seed}:${sourceRound}:${match.slot}`,
    });

    if (!resolution.winner || !resolution.loser) {
      return {
        ok: false,
        error: `${knockoutRoundLabel(sourceRound)} 第 ${match.slot} 场结果不足。`,
      };
    }

    resolutions.push({
      matchId: match.id,
      slot: match.slot,
      winnerEntryId: resolution.winner.entryId,
      loserEntryId: resolution.loser.entryId,
      winnerCandidateId: resolution.winner.candidateId,
      loserCandidateId: resolution.loser.candidateId,
    });
  }

  return { ok: true, matches: sourceMatches, resolutions };
}

async function finalizeTerminalKnockoutResults(
  tournamentId: string,
  existingMatches: TournamentMatch[],
  seed: string,
  createdBy: string,
): Promise<
  ActionResult<{
    refresh: boolean;
    seed: string;
    finalizedMatches: number;
    contestIds: string[];
  }>
> {
  const terminalRounds: TerminalKnockoutRound[] = [];
  if (
    existingMatches.some(
      (match) => normalizeKnockoutRound(match.round) === "final",
    )
  ) {
    terminalRounds.push("final");
  }
  if (
    existingMatches.some(
      (match) => normalizeKnockoutRound(match.round) === "third_place",
    )
  ) {
    terminalRounds.push("third_place");
  }

  if (!terminalRounds.includes("final")) {
    return actionFailure("请先生成冠军赛。");
  }

  const supabase = createRequiredServiceClient();
  const finalized: Array<{
    round: TerminalKnockoutRound;
    match: TournamentMatch;
    resolution: KnockoutMatchResolutionPayload;
  }> = [];

  for (const round of terminalRounds) {
    const source = await resolveKnockoutSourceMatches(
      tournamentId,
      round,
      1,
      seed,
    );
    if (!source.ok) {
      return actionFailure(source.error);
    }

    const resolution = source.resolutions[0];
    const match = source.matches.find((item) => item.id === resolution?.matchId);
    if (!resolution || !match) {
      return actionFailure(`${knockoutRoundLabel(round)} 结果不足。`);
    }

    finalized.push({ round, match, resolution });
  }

  const finalResolution = finalized.find((item) => item.round === "final");
  if (!finalResolution) {
    return actionFailure("冠军赛结果不足。");
  }

  for (const item of finalized) {
    const { error } = await supabase
      .from("tournament_matches")
      .update({
        winner_entry_id: item.resolution.winnerEntryId,
        loser_entry_id: item.resolution.loserEntryId,
      })
      .eq("id", item.resolution.matchId)
      .eq("tournament_id", tournamentId);

    if (error) {
      return actionFailure(error.message);
    }
  }

  const championEntryId = finalResolution.resolution.winnerEntryId;
  const { error: championError } = await supabase
    .from("tournament_entries")
    .update({ status: "champion" })
    .eq("tournament_id", tournamentId)
    .eq("id", championEntryId);
  if (championError) {
    return actionFailure(championError.message);
  }

  const { error: eliminatedError } = await supabase
    .from("tournament_entries")
    .update({ status: "eliminated" })
    .eq("tournament_id", tournamentId)
    .neq("id", championEntryId)
    .neq("status", "withdrawn");
  if (eliminatedError) {
    return actionFailure(eliminatedError.message);
  }

  const { error: tournamentError } = await supabase
    .from("tournaments")
    .update({ status: "completed" })
    .eq("id", tournamentId);
  if (tournamentError) {
    return actionFailure(tournamentError.message);
  }

  const contestIds = finalized
    .map((item) => item.match.contest_id)
    .filter((contestId): contestId is string => Boolean(contestId));
  const input = {
    tournamentId,
    rounds: terminalRounds,
    matches: finalized.map((item) => ({
      matchId: item.match.id,
      round: item.round,
      slot: item.match.slot,
      contestId: item.match.contest_id,
    })),
  };
  const output = {
    finalizedMatches: finalized.map((item) => ({
      round: item.round,
      matchId: item.resolution.matchId,
      slot: item.resolution.slot,
      winnerEntryId: item.resolution.winnerEntryId,
      loserEntryId: item.resolution.loserEntryId,
    })),
    championEntryId,
  };
  const { error: logError } = await supabase.from("tournament_draw_logs").insert({
    tournament_id: tournamentId,
    stage_id: finalResolution.match.stage_id,
    kind: "knockout_finalization",
    seed,
    input: input as Json,
    output: output as Json,
    created_by: createdBy,
  });
  if (logError) {
    return actionFailure(logError.message);
  }

  return actionSuccess("正赛最终结果已结算。", {
    refresh: true,
    seed,
    finalizedMatches: finalized.length,
    contestIds,
  });
}

export async function createTournamentAction(
  formData: FormData,
): Promise<ActionResult> {
  const adminResult = await getActionAdmin();
  if (!adminResult.ok) {
    return actionFailure(adminResult.error);
  }

  const parsed = createTournamentSchema.safeParse({
    name: formData.get("name"),
    screeningContestId: formData.get("screeningContestId"),
  });

  if (!parsed.success) {
    return actionFailure(parsed.error.issues[0]?.message ?? "赛事信息无效。");
  }

  try {
    const supabase = createRequiredServiceClient();
    const { data, error } = await supabase.rpc(
      "create_tournament_with_screening_stage_atomic",
      {
        p_name: parsed.data.name,
        p_screening_contest_id: parsed.data.screeningContestId,
        p_config: {
          format: "butter_vote_tournament_v1",
          stages: {
            screening: { durationHours: 72, advancerLimit: 48 },
            preliminary: { durationHours: 72, maxChoices: 4 },
            tiebreaker: { durationHours: 24, maxChoices: 1 },
            knockout: { durationHours: 48, maxChoices: 1 },
          },
        } satisfies Json,
        p_created_by: adminResult.profile.id,
      },
    );

    if (error) {
      return actionFailure(error.message);
    }

    const tournamentId = isRecord(data) ? data.tournamentId : null;
    revalidatePath("/admin");
    revalidatePath("/admin/tournaments");
    revalidatePath(`/contests/${parsed.data.screeningContestId}/results`);

    return actionSuccess("赛事已创建", {
      redirectTo:
        typeof tournamentId === "string"
          ? `/admin/tournaments?tournament=${tournamentId}`
          : "/admin/tournaments",
    });
  } catch (error) {
    return actionFailure(error instanceof Error ? error.message : "创建赛事失败。");
  }
}

export async function generatePreliminaryStageAction(
  formData: FormData,
): Promise<ActionResult> {
  const adminResult = await getActionAdmin();
  if (!adminResult.ok) {
    return actionFailure(adminResult.error);
  }

  const parsed = generatePreliminarySchema.safeParse({
    tournamentId: formData.get("tournamentId"),
    targetGroupId: optionalUuidFromForm(formData.get("targetGroupId")),
    seed: String(formData.get("seed") ?? "").trim() || undefined,
  });

  if (!parsed.success) {
    return actionFailure(parsed.error.issues[0]?.message ?? "预赛生成请求无效。");
  }

  try {
    const supabase = createRequiredServiceClient();
    const [
      { data: tournament, error: tournamentError },
      { data: screeningStage, error: screeningStageError },
    ] = await Promise.all([
      supabase
        .from("tournaments")
        .select("id,name")
        .eq("id", parsed.data.tournamentId)
        .maybeSingle(),
      supabase
        .from("tournament_stages")
        .select("id,contest_id")
        .eq("tournament_id", parsed.data.tournamentId)
        .eq("kind", "screening")
        .order("sequence", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

    if (tournamentError || !tournament) {
      return actionFailure(tournamentError?.message ?? "赛事不存在。");
    }

    if (screeningStageError || !screeningStage?.contest_id) {
      return actionFailure(screeningStageError?.message ?? "赛事尚未关联海选活动。");
    }

    const screening = await getContestResults(screeningStage.contest_id);
    if (!screening.ok) {
      return actionFailure(screening.error);
    }

    if (!["closed", "published"].includes(screening.contest.status)) {
      return actionFailure("请先结束海选活动，再生成预赛。");
    }

    const seed =
      parsed.data.seed ??
      `preliminary:${parsed.data.tournamentId}:${new Date().toISOString()}`;
    const screeningResolution = resolveScreeningAdvancers(screening.results, 48);

    if (screeningResolution.advancers.length === 0) {
      return actionFailure("海选暂无可晋级候选项。");
    }

    const pools = buildPreliminaryPools(screeningResolution.advancers, seed);
    const groups = drawPreliminaryGroups(pools.pool1, pools.pool2, seed);
    const groupPayload = (Object.entries(groups) as Array<
      [PreliminaryGroupKey, TallyResult[]]
    >).map(([group, candidates]) => ({
      group,
      candidates: candidates.map((candidate) => ({
        candidateId: candidate.candidateId,
        screeningRank: candidate.resolvedRank,
      })),
    }));
    const input = {
      screeningContestId: screeningStage.contest_id,
      advancerLimit: 48,
      boundary: {
        score: screeningResolution.boundary.score,
        cutoffPosition: screeningResolution.boundary.cutoffPosition,
        isExtendedByTie: screeningResolution.boundary.isExtendedByTie,
        extraAdvancerCount: screeningResolution.boundary.extraAdvancerCount,
        tiedCandidates: screeningResolution.boundary.tiedCandidates.map(
          toCandidatePayload,
        ),
      },
      advancers: screeningResolution.advancers.map(toCandidatePayload),
      pool1: pools.pool1.map(toCandidatePayload),
      pool2: pools.pool2.map(toCandidatePayload),
      randomizedPoolBoundary: pools.randomizedBoundaryCandidates.map(
        toCandidatePayload,
      ),
    };
    const output = {
      groups: Object.fromEntries(
        (Object.entries(groups) as Array<[PreliminaryGroupKey, TallyResult[]]>).map(
          ([group, candidates]) => [group, candidates.map(toCandidatePayload)],
        ),
      ),
      groupSizes: Object.fromEntries(
        (Object.entries(groups) as Array<[PreliminaryGroupKey, TallyResult[]]>).map(
          ([group, candidates]) => [group, candidates.length],
        ),
      ),
    };

    const { data, error } = await supabase.rpc("create_preliminary_stage_atomic", {
      p_tournament_id: parsed.data.tournamentId,
      p_screening_stage_id: screeningStage.id,
      p_target_group_id: parsed.data.targetGroupId,
      p_seed: seed,
      p_input: input as Json,
      p_output: output as Json,
      p_groups: groupPayload as Json,
      p_created_by: adminResult.profile.id,
    });

    if (error) {
      return actionFailure(error.message);
    }

    const contestIds = extractStringArray(data, "contestIds");
    revalidatePath("/admin");
    revalidatePath("/admin/tournaments");
    revalidatePath(`/contests/${screeningStage.contest_id}/results`);

    for (const contestId of contestIds) {
      revalidatePath(`/admin/contests/${contestId}/edit`);
      revalidatePath(`/contests/${contestId}`);
      revalidatePath(`/contests/${contestId}/results`);
    }

    if (parsed.data.targetGroupId) {
      revalidatePath(`/admin/groups/${parsed.data.targetGroupId}`);
      revalidatePath(`/groups/${parsed.data.targetGroupId}`);
    }

    return actionSuccess(
      `已生成预赛 A/B/C/D 四组，共继承 ${
        isRecord(data) && typeof data.entryCount === "number"
          ? data.entryCount
          : screeningResolution.advancers.length
      } 个候选项`,
      {
        refresh: true,
        seed,
        input: jsonString(input),
        output: jsonString(output),
      },
    );
  } catch (error) {
    return actionFailure(error instanceof Error ? error.message : "生成预赛失败。");
  }
}

export async function generatePreliminaryTiebreakersAction(
  formData: FormData,
): Promise<ActionResult> {
  const adminResult = await getActionAdmin();
  if (!adminResult.ok) {
    return actionFailure(adminResult.error);
  }

  const parsed = generateFollowupStageSchema.safeParse({
    tournamentId: formData.get("tournamentId"),
    targetGroupId: optionalUuidFromForm(formData.get("targetGroupId")),
    seed: String(formData.get("seed") ?? "").trim() || undefined,
  });

  if (!parsed.success) {
    return actionFailure(parsed.error.issues[0]?.message ?? "加赛生成请求无效。");
  }

  try {
    const supabase = createRequiredServiceClient();
    const { data: tournament } = await supabase
      .from("tournaments")
      .select("id,name")
      .eq("id", parsed.data.tournamentId)
      .maybeSingle();

    if (!tournament) {
      return actionFailure("赛事不存在。");
    }

    if (await hasActiveTournamentStage(parsed.data.tournamentId, "tiebreaker")) {
      return actionFailure("该赛事已经生成过预赛加赛。");
    }

    const preliminary = await getPreliminaryResolutionBundles(
      parsed.data.tournamentId,
    );
    if (!preliminary.ok) {
      return actionFailure(preliminary.error);
    }

    const pendingContests = preliminary.bundles.filter(
      (bundle) => !assertClosedContest(bundle.contest),
    );
    if (pendingContests.length > 0) {
      return actionFailure("请先结束所有预赛活动，再生成加赛。");
    }

    const tiebreakerBundles = preliminary.bundles.filter(
      (bundle) => bundle.resolution.needsTiebreaker,
    );
    if (tiebreakerBundles.length === 0) {
      return actionSuccess("当前预赛结果不需要加赛", { refresh: true });
    }

    const seed =
      parsed.data.seed ??
      `tiebreaker:${parsed.data.tournamentId}:${new Date().toISOString()}`;
    const tiebreakers = tiebreakerBundles.flatMap((bundle) => {
      const items: Array<{
        preliminaryGroup: PreliminaryGroupKey;
        tieKind: TiebreakerTieKind;
        sourceStageId: string;
        sourceContestId: string | null;
        candidates: Array<{
          candidateId: string;
          score: number;
          lastVoteAt: string | null;
        }>;
        metadata: Record<string, unknown>;
      }> = [];

      if (bundle.resolution.groupFirstTie) {
        items.push({
          preliminaryGroup: bundle.group,
          tieKind: "group_first",
          sourceStageId: bundle.stage.id,
          sourceContestId: bundle.stage.contest_id,
          candidates: bundle.resolution.groupFirstTie.candidates.map(
            (candidate) => ({
              candidateId: candidate.candidateId,
              score: candidate.score,
              lastVoteAt: candidate.lastVoteAt,
            }),
          ),
          metadata: {
            preliminaryGroup: bundle.group,
            tieKind: "group_first",
            titleSuffix: "小组第一加赛",
            sourceStageId: bundle.stage.id,
            sourceContestId: bundle.stage.contest_id,
            groupFirstTie: {
              score: bundle.resolution.groupFirstTie.score,
              candidateIds: bundle.resolution.groupFirstTie.candidates.map(
                (candidate) => candidate.candidateId,
              ),
            },
            advancementTie: null,
          },
        });
      }

      if (bundle.resolution.advancementTie) {
        items.push({
          preliminaryGroup: bundle.group,
          tieKind: "advancement",
          sourceStageId: bundle.stage.id,
          sourceContestId: bundle.stage.contest_id,
          candidates: bundle.resolution.advancementTie.candidates.map(
            (candidate) => ({
              candidateId: candidate.candidateId,
              score: candidate.score,
              lastVoteAt: candidate.lastVoteAt,
            }),
          ),
          metadata: {
            preliminaryGroup: bundle.group,
            tieKind: "advancement",
            titleSuffix: "晋级名额加赛",
            sourceStageId: bundle.stage.id,
            sourceContestId: bundle.stage.contest_id,
            advancementTie: {
              score: bundle.resolution.advancementTie.score,
              remainingSlots: bundle.resolution.advancementTie.remainingSlots,
              candidateIds: bundle.resolution.advancementTie.candidates.map(
                (candidate) => candidate.candidateId,
              ),
            },
            groupFirstTie: null,
          },
        });
      }

      return items;
    });
    const input = {
      tournamentId: parsed.data.tournamentId,
      preliminaryGroups: tiebreakerBundles.map((bundle) => ({
        group: bundle.group,
        contestId: bundle.stage.contest_id,
        ordered: bundle.resolution.ordered.map(toCandidatePayload),
        advancementTie: bundle.resolution.advancementTie
          ? {
              remainingSlots: bundle.resolution.advancementTie.remainingSlots,
              candidates: bundle.resolution.advancementTie.candidates.map(
                toCandidatePayload,
              ),
            }
          : null,
        groupFirstTie: bundle.resolution.groupFirstTie
          ? bundle.resolution.groupFirstTie.candidates.map(toCandidatePayload)
          : null,
      })),
      splitTiebreakers: tiebreakers.map((item) => ({
        preliminaryGroup: item.preliminaryGroup,
        tieKind: item.tieKind,
        candidates: item.candidates,
      })),
    };
    const output = {
      tiebreakers: tiebreakers.map((item) => ({
        preliminaryGroup: item.preliminaryGroup,
        tieKind: item.tieKind,
        candidates: item.candidates,
        metadata: item.metadata,
      })),
    };

    const { data, error } = await supabase.rpc(
      "create_preliminary_tiebreakers_atomic",
      {
        p_tournament_id: parsed.data.tournamentId,
        p_target_group_id: parsed.data.targetGroupId,
        p_seed: seed,
        p_input: input as Json,
        p_output: output as Json,
        p_tiebreakers: tiebreakers as Json,
        p_created_by: adminResult.profile.id,
      },
    );

    if (error) {
      return actionFailure(error.message);
    }

    const contestIds = extractStringArray(data, "contestIds");
    const titleUpdates = await Promise.all(
      contestIds.map((contestId, index) => {
        const tiebreaker = tiebreakers[index];
        if (!tiebreaker) {
          return Promise.resolve({ error: null });
        }

        const suffix =
          tiebreaker.tieKind === "group_first"
            ? "小组第一加赛"
            : "晋级名额加赛";
        return supabase
          .from("contests")
          .update({
            title: `${tournament.name} 预赛加赛 ${tiebreaker.preliminaryGroup} 组 ${suffix}`,
          })
          .eq("id", contestId);
      }),
    );
    const titleUpdateError = titleUpdates.find((result) => result.error)?.error;
    if (titleUpdateError) {
      return actionFailure(titleUpdateError.message);
    }

    revalidatePath("/admin/tournaments");
    for (const contestId of contestIds) {
      revalidatePath(`/admin/contests/${contestId}/edit`);
      revalidatePath(`/contests/${contestId}`);
      revalidatePath(`/contests/${contestId}/results`);
    }
    if (parsed.data.targetGroupId) {
      revalidatePath(`/admin/groups/${parsed.data.targetGroupId}`);
      revalidatePath(`/groups/${parsed.data.targetGroupId}`);
    }

    return actionSuccess(`已生成 ${contestIds.length} 场预赛加赛`, {
      refresh: true,
      seed,
    });
  } catch (error) {
    return actionFailure(error instanceof Error ? error.message : "生成加赛失败。");
  }
}

export async function generateKnockoutStageAction(
  formData: FormData,
): Promise<ActionResult> {
  const adminResult = await getActionAdmin();
  if (!adminResult.ok) {
    return actionFailure(adminResult.error);
  }

  const parsed = generateFollowupStageSchema.safeParse({
    tournamentId: formData.get("tournamentId"),
    targetGroupId: optionalUuidFromForm(formData.get("targetGroupId")),
    seed: String(formData.get("seed") ?? "").trim() || undefined,
  });

  if (!parsed.success) {
    return actionFailure(parsed.error.issues[0]?.message ?? "正赛生成请求无效。");
  }

  try {
    const supabase = createRequiredServiceClient();
    const { data: tournament } = await supabase
      .from("tournaments")
      .select("id,name")
      .eq("id", parsed.data.tournamentId)
      .maybeSingle();

    if (!tournament) {
      return actionFailure("赛事不存在。");
    }

    if (await hasActiveTournamentStage(parsed.data.tournamentId, "knockout")) {
      return actionFailure("该赛事已经生成过正赛。");
    }

    const preliminary = await getPreliminaryResolutionBundles(
      parsed.data.tournamentId,
    );
    if (!preliminary.ok) {
      return actionFailure(preliminary.error);
    }
    if (preliminary.bundles.length !== 4) {
      return actionFailure("正赛需要 A/B/C/D 四个预赛组。");
    }

    const pendingPreliminary = preliminary.bundles.filter(
      (bundle) => !assertClosedContest(bundle.contest),
    );
    if (pendingPreliminary.length > 0) {
      return actionFailure("请先结束所有预赛活动，再生成正赛。");
    }

    const tiebreakerStages = await getActiveTournamentStages(
      parsed.data.tournamentId,
      "tiebreaker",
    );
    function findTiebreakerStage(
      group: PreliminaryGroupKey,
      tieKind: TiebreakerTieKind,
    ) {
      return tiebreakerStages.find(
        (stage) =>
          stagePreliminaryGroup(stage) === group &&
          (stageTieKind(stage) === tieKind || stageHasLegacyTie(stage, tieKind)),
      );
    }
    const tiebreakerStageByGroup = new Map(
      tiebreakerStages
        .map((stage) => [stagePreliminaryGroup(stage), stage] as const)
        .filter(
          (item): item is readonly [PreliminaryGroupKey, TournamentStage] =>
            Boolean(item[0]),
        ),
    );
    const entryByCandidate = entryMapByCandidateId(preliminary.entries);
    const selectedEntries: KnockoutEntrySeed[] = [];

    for (const bundle of preliminary.bundles) {
      const preliminaryResultById = resultByCandidateId(bundle.results);
      let advancerSourceIds = bundle.resolution.advancers.map(
        (candidate) => candidate.candidateId,
      );
      let groupWinnerSourceId = bundle.resolution.ordered[0]?.candidateId ?? null;
      let advancementOrderedSourceIds: string[] = [];
      const lockedAdvancerSourceIds = bundle.resolution.lockedAdvancers.map(
        (candidate) => candidate.candidateId,
      );

      if (bundle.resolution.advancementTie && bundle.resolution.groupFirstTie) {
        const advancementStage = findTiebreakerStage(bundle.group, "advancement");
        if (!advancementStage?.contest_id) {
          return actionFailure(
            `${bundle.group} 组仍需要晋级名额加赛，请先生成并结束加赛。`,
          );
        }

        const advancementTiebreaker = await getContestResults(
          advancementStage.contest_id,
        );
        if (!advancementTiebreaker.ok) {
          return actionFailure(advancementTiebreaker.error);
        }
        if (!assertClosedContest(advancementTiebreaker.contest)) {
          return actionFailure(`${bundle.group} 组晋级名额加赛尚未结束。`);
        }

        const advancementCandidateIds = new Set(
          bundle.resolution.advancementTie.candidates.map(
            (candidate) => candidate.candidateId,
          ),
        );
        const advancementResults = toSourceTiebreakerResults(
          advancementTiebreaker,
        );
        const advancementResolution = resolveExpectedTiebreakerCandidates({
          results: advancementResults,
          expectedCandidateIds: [...advancementCandidateIds],
          slots: bundle.resolution.advancementTie.remainingSlots,
          seed: `${parsed.data.seed ?? "knockout"}:${bundle.group}:advancement`,
          label: `${bundle.group} 组晋级名额`,
        });
        if (!advancementResolution.ok) {
          return actionFailure(advancementResolution.error);
        }
        advancementOrderedSourceIds =
          advancementResolution.resolution.ordered.map(
            (candidate) => candidate.candidateId,
          );
        advancerSourceIds = [
          ...lockedAdvancerSourceIds,
          ...advancementResolution.resolution.selected.map(
            (candidate) => candidate.candidateId,
          ),
        ];

        const groupFirstStage = findTiebreakerStage(bundle.group, "group_first");
        if (!groupFirstStage?.contest_id) {
          return actionFailure(
            `${bundle.group} 组仍需要小组第一加赛，请先生成并结束加赛。`,
          );
        }

        const groupFirstTiebreaker = await getContestResults(
          groupFirstStage.contest_id,
        );
        if (!groupFirstTiebreaker.ok) {
          return actionFailure(groupFirstTiebreaker.error);
        }
        if (!assertClosedContest(groupFirstTiebreaker.contest)) {
          return actionFailure(`${bundle.group} 组小组第一加赛尚未结束。`);
        }

        const groupFirstCandidateIds = new Set(
          bundle.resolution.groupFirstTie.candidates.map(
            (candidate) => candidate.candidateId,
          ),
        );
        const groupFirstResults = toSourceTiebreakerResults(
          groupFirstTiebreaker,
        );
        const groupFirstResolution = resolveExpectedTiebreakerCandidates({
          results: groupFirstResults,
          expectedCandidateIds: [...groupFirstCandidateIds],
          slots: 1,
          seed: `${parsed.data.seed ?? "knockout"}:${bundle.group}:group-first`,
          label: `${bundle.group} 组小组第一`,
        });
        if (!groupFirstResolution.ok) {
          return actionFailure(groupFirstResolution.error);
        }
        groupWinnerSourceId =
          groupFirstResolution.resolution.selected[0]?.candidateId ?? null;
      } else if (bundle.resolution.needsTiebreaker) {
        const tiebreakerStage = tiebreakerStageByGroup.get(bundle.group);
        if (!tiebreakerStage?.contest_id) {
          return actionFailure(
            `${bundle.group} 组仍需要加赛，请先生成并结束加赛。`,
          );
        }

        const tiebreaker = await getContestResults(tiebreakerStage.contest_id);
        if (!tiebreaker.ok) {
          return actionFailure(tiebreaker.error);
        }
        if (!assertClosedContest(tiebreaker.contest)) {
          return actionFailure(`${bundle.group} 组加赛尚未结束。`);
        }

        const sourceResults = toSourceTiebreakerResults(tiebreaker);

        if (bundle.resolution.advancementTie) {
          const advancementCandidateIds = new Set(
            bundle.resolution.advancementTie.candidates.map(
              (candidate) => candidate.candidateId,
            ),
          );
          const advancementResults = sourceResults.filter((result) =>
            advancementCandidateIds.has(result.candidateId),
          );
          const advancementResolution = resolveExpectedTiebreakerCandidates({
            results: advancementResults,
            expectedCandidateIds: [...advancementCandidateIds],
            slots: bundle.resolution.advancementTie.remainingSlots,
            seed: `${parsed.data.seed ?? "knockout"}:${bundle.group}:advancement`,
            label: `${bundle.group} 组晋级名额`,
          });
          if (!advancementResolution.ok) {
            return actionFailure(advancementResolution.error);
          }
          advancementOrderedSourceIds =
            advancementResolution.resolution.ordered.map(
              (candidate) => candidate.candidateId,
            );
          advancerSourceIds = [
            ...lockedAdvancerSourceIds,
            ...advancementResolution.resolution.selected.map(
              (candidate) => candidate.candidateId,
            ),
          ];
        }

        if (bundle.resolution.groupFirstTie) {
          const groupFirstCandidateIds = new Set(
            bundle.resolution.groupFirstTie.candidates.map(
              (candidate) => candidate.candidateId,
            ),
          );
          const groupFirstResults = sourceResults.filter((result) =>
            groupFirstCandidateIds.has(result.candidateId),
          );
          const groupFirstResolution = resolveExpectedTiebreakerCandidates({
            results: groupFirstResults,
            expectedCandidateIds: [...groupFirstCandidateIds],
            slots: 1,
            seed: `${parsed.data.seed ?? "knockout"}:${bundle.group}:group-first`,
            label: `${bundle.group} 组小组第一`,
          });
          if (!groupFirstResolution.ok) {
            return actionFailure(groupFirstResolution.error);
          }
          groupWinnerSourceId =
            groupFirstResolution.resolution.selected[0]?.candidateId ?? null;
        }
      }

      const reconciledAdvancers = reconcilePreliminaryAdvancerIds({
        advancerCandidateIds: advancerSourceIds,
        lockedAdvancerCandidateIds: lockedAdvancerSourceIds,
        groupWinnerCandidateId: groupWinnerSourceId,
        advancementOrderedCandidateIds: advancementOrderedSourceIds,
      });

      if (!reconciledAdvancers.ok) {
        return actionFailure(`${bundle.group} 组晋级结果不足 4 名。`);
      }

      advancerSourceIds = reconciledAdvancers.candidateIds;

      advancerSourceIds.forEach((candidateId, index) => {
        const entry = entryByCandidate.get(candidateId);
        const preliminaryResult = preliminaryResultById.get(candidateId);
        if (!entry?.current_candidate_id || !preliminaryResult) {
          throw new Error(`${bundle.group} 组晋级者赛事登记不完整。`);
        }

        selectedEntries.push({
          candidateId: entry.id,
          entryId: entry.id,
          currentCandidateId: entry.current_candidate_id,
          preliminaryGroup: bundle.group,
          preliminaryRank: index + 1,
          isGroupWinner: candidateId === groupWinnerSourceId,
          score: preliminaryResult.score,
          lastVoteAt: preliminaryResult.lastVoteAt,
          name: preliminaryResult.name,
        });
      });
    }

    if (selectedEntries.length !== 16) {
      return actionFailure("正赛需要 16 名晋级者。");
    }

    const groupWinners = Object.fromEntries(
      selectedEntries
        .filter((entry) => entry.isGroupWinner)
        .map((entry) => [entry.preliminaryGroup, entry]),
    ) as Partial<Record<PreliminaryGroupKey, KnockoutEntrySeed>>;
    const otherAdvancers = selectedEntries.filter((entry) => !entry.isGroupWinner);

    if (Object.keys(groupWinners).length !== 4 || otherAdvancers.length !== 12) {
      return actionFailure("正赛需要 4 名小组第一和 12 名其他晋级者。");
    }

    const seed =
      parsed.data.seed ??
      `knockout:${parsed.data.tournamentId}:${new Date().toISOString()}`;
    const bracket = buildKnockoutBracket(groupWinners, otherAdvancers, seed);
    const entriesPayload = selectedEntries.map((entry) => ({
      entryId: entry.entryId,
      preliminaryGroup: entry.preliminaryGroup,
      preliminaryRank: entry.preliminaryRank,
      isGroupWinner: entry.isGroupWinner,
    }));
    const matchesPayload = bracket.matches.map((match) => ({
      slot: match.slot,
      leftSlot: match.leftSlot,
      rightSlot: match.rightSlot,
      leftEntryId: match.left?.entryId ?? null,
      rightEntryId: match.right?.entryId ?? null,
    }));
    const input = {
      tournamentId: parsed.data.tournamentId,
      finalists: selectedEntries.map((entry) => ({
        entryId: entry.entryId,
        currentCandidateId: entry.currentCandidateId,
        preliminaryGroup: entry.preliminaryGroup,
        preliminaryRank: entry.preliminaryRank,
        isGroupWinner: entry.isGroupWinner,
        name: entry.name,
      })),
    };
    const output = {
      slots: bracket.slots.map((slot) => ({
        slot: slot.slot,
        entryId: slot.entry?.entryId ?? null,
        fixedGroupWinner: slot.fixedGroupWinner ?? null,
      })),
      matches: matchesPayload,
    };

    const { data, error } = await supabase.rpc("create_knockout_stage_atomic", {
      p_tournament_id: parsed.data.tournamentId,
      p_target_group_id: parsed.data.targetGroupId,
      p_seed: seed,
      p_input: input as Json,
      p_output: output as Json,
      p_entries: entriesPayload as Json,
      p_matches: matchesPayload as Json,
      p_created_by: adminResult.profile.id,
    });

    if (error) {
      return actionFailure(error.message);
    }

    const contestIds = extractStringArray(data, "contestIds");
    revalidatePath("/admin/tournaments");
    for (const contestId of contestIds) {
      revalidatePath(`/admin/contests/${contestId}/edit`);
      revalidatePath(`/contests/${contestId}`);
      revalidatePath(`/contests/${contestId}/results`);
    }
    if (parsed.data.targetGroupId) {
      revalidatePath(`/admin/groups/${parsed.data.targetGroupId}`);
      revalidatePath(`/groups/${parsed.data.targetGroupId}`);
    }

    return actionSuccess(`已生成正赛 16 强 ${contestIds.length} 场`, {
      refresh: true,
      seed,
    });
  } catch (error) {
    return actionFailure(error instanceof Error ? error.message : "生成正赛失败。");
  }
}

export async function generateNextKnockoutRoundAction(
  formData: FormData,
): Promise<ActionResult> {
  const adminResult = await getActionAdmin();
  if (!adminResult.ok) {
    return actionFailure(adminResult.error);
  }

  const parsed = generateFollowupStageSchema.safeParse({
    tournamentId: formData.get("tournamentId"),
    targetGroupId: optionalUuidFromForm(formData.get("targetGroupId")),
    seed: String(formData.get("seed") ?? "").trim() || undefined,
  });

  if (!parsed.success) {
    return actionFailure(parsed.error.issues[0]?.message ?? "正赛生成请求无效。");
  }

  try {
    const supabase = createRequiredServiceClient();
    const [{ data: tournament }, { data: matches, error: matchesError }] =
      await Promise.all([
        supabase
          .from("tournaments")
          .select("id,name,status")
          .eq("id", parsed.data.tournamentId)
          .maybeSingle(),
        supabase
          .from("tournament_matches")
          .select(
            "id,tournament_id,stage_id,contest_id,round,slot,left_entry_id,right_entry_id,winner_entry_id,loser_entry_id,metadata,created_at,updated_at",
          )
          .eq("tournament_id", parsed.data.tournamentId)
          .order("created_at", { ascending: true }),
      ]);

    if (!tournament) {
      return actionFailure("赛事不存在。");
    }
    if (matchesError) {
      return actionFailure(matchesError.message);
    }

    const existingMatches = await filterActiveMatches(
      (matches ?? []) as TournamentMatch[],
    );
    const seed =
      parsed.data.seed ??
      `knockout-next:${parsed.data.tournamentId}:${new Date().toISOString()}`;
    const plan = planNextKnockoutRound(existingMatches);
    if (!plan.ok) {
      const hasTerminalMatch = existingMatches.some((match) => {
        const round = normalizeKnockoutRound(match.round);
        return round === "final" || round === "third_place";
      });

      if (hasTerminalMatch) {
        const terminalMatches = existingMatches.filter((match) => {
          const round = normalizeKnockoutRound(match.round);
          return round === "final" || round === "third_place";
        });
        const terminalContestIds = terminalMatches
          .map((match) => match.contest_id)
          .filter((contestId): contestId is string => Boolean(contestId));
        const terminalResolved = terminalMatches.every(
          (match) => match.winner_entry_id && match.loser_entry_id,
        );

        if (tournament.status === "completed" && terminalResolved) {
          revalidatePath("/");
          revalidatePath("/admin/tournaments");
          for (const contestId of terminalContestIds) {
            revalidatePath(`/admin/contests/${contestId}/edit`);
            revalidatePath(`/contests/${contestId}`);
            revalidatePath(`/contests/${contestId}/results`);
          }

          return actionSuccess("正赛最终结果已结算。", {
            refresh: true,
            seed,
            finalizedMatches: 0,
            contestIds: terminalContestIds,
          });
        }

        const finalized = await finalizeTerminalKnockoutResults(
          parsed.data.tournamentId,
          existingMatches,
          seed,
          adminResult.profile.id,
        );
        if (!finalized.ok) {
          return finalized;
        }

        revalidatePath("/");
        revalidatePath("/admin/tournaments");
        for (const contestId of finalized.contestIds) {
          revalidatePath(`/admin/contests/${contestId}/edit`);
          revalidatePath(`/contests/${contestId}`);
          revalidatePath(`/contests/${contestId}/results`);
        }

        return finalized;
      }

      return actionFailure(plan.error);
    }

    const source = await resolveKnockoutSourceMatches(
      parsed.data.tournamentId,
      plan.sourceRound,
      plan.expectedSourceCount,
      seed,
    );
    if (!source.ok) {
      return actionFailure(source.error);
    }

    const resolutionBySlot = new Map(
      source.resolutions.map((resolution) => [resolution.slot, resolution]),
    );
    const targetMatches = plan.targetMatches.map((target) => {
      const leftSource = resolutionBySlot.get(target.sourceSlots[0]);
      const rightSource = resolutionBySlot.get(target.sourceSlots[1]);
      if (!leftSource || !rightSource) {
        throw new Error("正赛来源场次结果不完整。");
      }

      const participant =
        "participant" in target ? target.participant : ("winner" as const);
      const roundLabel = knockoutRoundLabel(target.round);
      const title =
        target.round === "final" || target.round === "third_place"
          ? roundLabel
          : `${roundLabel} 第 ${target.slot} 场`;

      return {
        round: target.round,
        slot: target.slot,
        title,
        leftEntryId:
          participant === "loser"
            ? leftSource.loserEntryId
            : leftSource.winnerEntryId,
        rightEntryId:
          participant === "loser"
            ? rightSource.loserEntryId
            : rightSource.winnerEntryId,
        sourceRound: plan.sourceRound,
        sourceSlots: target.sourceSlots,
        participant,
      };
    });
    const input = {
      tournamentId: parsed.data.tournamentId,
      sourceRound: plan.sourceRound,
      sourceMatches: source.resolutions,
    };
    const output = { matches: targetMatches };

    const { data, error } = await supabase.rpc(
      "create_knockout_followup_matches_atomic",
      {
        p_tournament_id: parsed.data.tournamentId,
        p_target_group_id: parsed.data.targetGroupId,
        p_seed: seed,
        p_input: input as Json,
        p_output: output as Json,
        p_source_results: source.resolutions as Json,
        p_matches: targetMatches as Json,
        p_created_by: adminResult.profile.id,
      },
    );

    if (error) {
      return actionFailure(error.message);
    }

    const contestIds = extractStringArray(data, "contestIds");
    revalidatePath("/admin/tournaments");
    for (const contestId of contestIds) {
      revalidatePath(`/admin/contests/${contestId}/edit`);
      revalidatePath(`/contests/${contestId}`);
      revalidatePath(`/contests/${contestId}/results`);
    }
    if (parsed.data.targetGroupId) {
      revalidatePath(`/admin/groups/${parsed.data.targetGroupId}`);
      revalidatePath(`/groups/${parsed.data.targetGroupId}`);
    }

    const generatedRounds = Array.from(
      new Set(targetMatches.map((match) => knockoutRoundLabel(match.round))),
    ).join("、");
    return actionSuccess(`已生成${generatedRounds} ${contestIds.length} 场`, {
      refresh: true,
      seed,
    });
  } catch (error) {
    return actionFailure(
      error instanceof Error ? error.message : "生成下一轮正赛失败。",
    );
  }
}
