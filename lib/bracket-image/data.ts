import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadContestResultVisibilityByContest } from "@/lib/result-visibility";
import { createServiceClient } from "@/lib/supabase/service";
import { loadVisibleContestTallies, type VisibleContestTallyRow } from "@/lib/visible-result-tallies";
import { visibleTallyScore } from "@/lib/visible-tally-score";
import { contestResultVisibilityFromRow, type ContestResultVisibility } from "@/lib/result-visibility-model";
import {
  entryOutcomeIsHiddenInMatch,
  inheritedCandidateIsPublic,
  latestBracketVersion,
  resolveBracketResultVisibility,
} from "@/lib/tournament-bracket-visibility";
import type {
  Candidate,
  Contest,
  Database,
  Tournament,
  TournamentEntry,
  TournamentMatch,
} from "@/lib/types";
import type {
  BracketImageData,
  BracketImageMatch,
  BracketImageParticipant,
  BracketImageRound,
} from "@/lib/bracket-image/types";

type BracketClient = SupabaseClient<Database>;

type BracketTournament = Pick<
  Tournament,
  "id" | "name" | "status" | "updated_at"
>;

type BracketContest = Pick<
  Contest,
  | "id"
  | "title"
  | "status"
  | "vote_type"
  | "group_id"
  | "voting_starts_at"
  | "voting_ends_at"
  | "archived_at"
  | "created_at"
  | "updated_at"
>;

type BracketCandidate = Pick<
  Candidate,
  | "id"
  | "contest_id"
  | "name"
  | "description"
  | "image_path"
  | "nominator_display_name"
  | "inherited_from_candidate_id"
  | "is_active"
  | "created_at"
>;

type BracketEntry = Pick<
  TournamentEntry,
  | "id"
  | "root_candidate_id"
  | "current_candidate_id"
  | "source_candidate_id"
  | "screening_rank"
  | "preliminary_group"
  | "preliminary_rank"
  | "is_group_winner"
  | "status"
>;

export type BracketImageSnapshot = {
  tournament: BracketTournament;
  matches: TournamentMatch[];
  contests: BracketContest[];
  entries: BracketEntry[];
  candidates: BracketCandidate[];
  visibility: Database["public"]["Functions"]["get_contest_result_visibility"]["Returns"];
  tallies: VisibleContestTallyRow[];
  loveVoteWeight: number | null;
};

function scoresFromTallies(tallies: VisibleContestTallyRow[], weight: number, weighted: ReadonlySet<string>) {
  const scores = new Map<string, Map<string, number>>();
  for (const tally of tallies) {
    const current = scores.get(tally.contest_id) ?? new Map<string, number>();
    current.set(tally.candidate_id, visibleTallyScore(tally, weighted.has(tally.contest_id), weight));
    scores.set(tally.contest_id, current);
  }
  return scores;
}

const ROUND_ORDER: BracketImageRound[] = [
  "round_of_16",
  "quarterfinal",
  "semifinal",
  "final",
  "third_place",
];

const ROUND_LABEL: Record<BracketImageRound, string> = {
  round_of_16: "16 强",
  quarterfinal: "8 强",
  semifinal: "半决赛",
  final: "冠军赛",
  third_place: "季军赛",
};

function roundLabel(round: string) {
  return ROUND_LABEL[round as BracketImageRound] ?? "正赛";
}

function normalizeRound(round: string): BracketImageRound | null {
  return ROUND_ORDER.find((item) => item === round) ?? null;
}

function candidateIdsFromEntries(entries: BracketEntry[]) {
  return [
    ...new Set(
      entries
        .flatMap((entry) => [
          entry.root_candidate_id,
          entry.current_candidate_id,
          entry.source_candidate_id,
        ])
        .filter((candidateId): candidateId is string => Boolean(candidateId)),
    ),
  ];
}

function lineage(
  candidateId: string | null | undefined,
  candidates: Map<string, BracketCandidate>,
) {
  const ids = new Set<string>();
  let current = candidateId;

  while (current && !ids.has(current)) {
    ids.add(current);
    current = candidates.get(current)?.inherited_from_candidate_id;
  }

  return ids;
}

function candidateForEntry(
  entry: BracketEntry | null | undefined,
  candidates: Map<string, BracketCandidate>,
) {
  if (!entry) {
    return null;
  }

  const orderedCandidates = [
    entry.current_candidate_id ? candidates.get(entry.current_candidate_id) : null,
    entry.source_candidate_id ? candidates.get(entry.source_candidate_id) : null,
    candidates.get(entry.root_candidate_id) ?? null,
  ].filter((candidate): candidate is BracketCandidate => Boolean(candidate));

  return (
    orderedCandidates.find((candidate) => Boolean(candidate.image_path)) ??
    orderedCandidates[0] ??
    null
  );
}

function matchCandidateIdForEntry(
  entry: BracketEntry | null | undefined,
  matchCandidates: BracketCandidate[],
  candidates: Map<string, BracketCandidate>,
) {
  if (!entry) {
    return null;
  }

  return (
    matchCandidates.find((candidate) =>
      lineage(candidate.id, candidates).has(entry.root_candidate_id),
    )?.id ?? null
  );
}

async function fetchCandidateLineage(
  supabase: BracketClient,
  seedCandidateIds: string[],
) {
  const candidates = new Map<string, BracketCandidate>();
  let pending = [...new Set(seedCandidateIds)];

  while (pending.length > 0) {
    const current = pending;
    pending = [];

    const { data } = await supabase
      .from("candidates")
      .select(
        "id,contest_id,name,description,image_path,nominator_display_name,inherited_from_candidate_id,is_active,created_at",
      )
      .in("id", current)
      .eq("is_active", true);

    for (const candidate of (data ?? []) as BracketCandidate[]) {
      if (candidates.has(candidate.id)) {
        continue;
      }

      candidates.set(candidate.id, candidate);
      if (
        candidate.inherited_from_candidate_id &&
        !candidates.has(candidate.inherited_from_candidate_id)
      ) {
        pending.push(candidate.inherited_from_candidate_id);
      }
    }
  }

  return candidates;
}

async function tallyVisibleContestScores(
  supabase: BracketClient,
  structureClient: BracketClient,
  contests: BracketContest[],
  fullResultVisibleContestIds: ReadonlySet<string>,
  weightedLoveScoreContestIds: ReadonlySet<string>,
) {
  const scores = new Map<string, Map<string, number>>();
  const visibleContests = contests.filter((contest) =>
    fullResultVisibleContestIds.has(contest.id),
  );
  const visibleContestIds = visibleContests.map((contest) => contest.id);

  if (visibleContestIds.length === 0) {
    return scores;
  }

  const groupIds = [
    ...new Set(
      visibleContests
        .map((contest) => contest.group_id)
        .filter((groupId): groupId is string => Boolean(groupId)),
    ),
  ];
  const { data: groups } =
    groupIds.length > 0
      ? await structureClient
          .from("contest_groups")
          .select("id,love_vote_weight")
          .in("id", groupIds)
      : { data: [] };
  const loveVoteWeightByGroup = new Map(
    (groups ?? []).map((group) => [group.id, Number(group.love_vote_weight)]),
  );
  const result = await loadVisibleContestTallies(supabase, visibleContestIds, {
    includeAdminOverride: false,
    publishedContestIds: visibleContests.filter((contest) => contest.status === "published").map((contest) => contest.id),
  });
  if (result.error) {
    console.error("Failed to load bracket image scores.", result.error.message);
    return scores;
  }
  for (const contest of visibleContests) {
    const weight = contest.group_id ? loveVoteWeightByGroup.get(contest.group_id) ?? 1 : 1;
    const converted = scoresFromTallies(result.tallies.filter((row) => row.contest_id === contest.id), weight, weightedLoveScoreContestIds);
    if (converted.has(contest.id)) scores.set(contest.id, converted.get(contest.id)!);
  }
  return scores;
}

async function loadBracketImageData(params: {
  supabase: BracketClient;
  structureClient: BracketClient;
  tournamentId: string;
  groupId: string;
  groupName: string;
}): Promise<BracketImageData | null> {
  const { supabase, structureClient, tournamentId, groupId, groupName } = params;
  const [{ data: tournament }, { data: matches }] = await Promise.all([
    structureClient
      .from("tournaments")
      .select("id,name,status,updated_at")
      .eq("id", tournamentId)
      .neq("status", "archived")
      .maybeSingle(),
    structureClient
      .from("tournament_matches")
      .select(
        "id,tournament_id,stage_id,contest_id,round,slot,left_entry_id,right_entry_id,winner_entry_id,loser_entry_id,metadata,created_at,updated_at",
      )
      .eq("tournament_id", tournamentId),
  ]);

  if (!tournament) {
    return null;
  }

  const rawMatches = ((matches ?? []) as TournamentMatch[]).filter((match) => {
    return Boolean(match.contest_id && normalizeRound(match.round));
  });
  const contestIds = [
    ...new Set(
      rawMatches
        .map((match) => match.contest_id)
        .filter((contestId): contestId is string => Boolean(contestId)),
    ),
  ];

  if (contestIds.length === 0) {
    return {
      tournamentId: tournament.id,
      tournamentName: tournament.name,
      groupId,
      groupName,
      generatedAt: new Date().toISOString(),
      visibilityVersion: latestBracketVersion([tournament.updated_at]),
      matches: [],
    };
  }

  const { data: contests } = await structureClient
    .from("contests")
    .select(
      "id,title,status,vote_type,group_id,voting_starts_at,voting_ends_at,archived_at,created_at,updated_at",
    )
    .in("id", contestIds)
    .eq("group_id", groupId)
    .neq("status", "draft")
    .is("archived_at", null);
  const contestById = new Map(
    ((contests ?? []) as BracketContest[]).map((contest) => [contest.id, contest]),
  );
  const activeMatches = rawMatches.filter(
    (match) => match.contest_id && contestById.has(match.contest_id),
  );
  const entryIds = [
    ...new Set(
      activeMatches
        .flatMap((match) => [
          match.left_entry_id,
          match.right_entry_id,
          match.winner_entry_id,
          match.loser_entry_id,
        ])
        .filter((entryId): entryId is string => Boolean(entryId)),
    ),
  ];
  const { data: entries } =
    entryIds.length > 0
      ? await structureClient
          .from("tournament_entries")
          .select(
            "id,root_candidate_id,current_candidate_id,source_candidate_id,screening_rank,preliminary_group,preliminary_rank,is_group_winner,status",
          )
          .in("id", entryIds)
      : { data: [] };
  const { data: matchCandidates } =
    contestIds.length > 0
      ? await structureClient
          .from("candidates")
          .select(
            "id,contest_id,name,description,image_path,nominator_display_name,inherited_from_candidate_id,is_active,created_at",
          )
          .in("contest_id", contestIds)
          .eq("is_active", true)
      : { data: [] };
  const activeMatchCandidates = (matchCandidates ?? []) as BracketCandidate[];
  const candidateMap = await fetchCandidateLineage(
    structureClient,
    [
      ...candidateIdsFromEntries((entries ?? []) as BracketEntry[]),
      ...activeMatchCandidates.flatMap((candidate) => [
        candidate.id,
        candidate.inherited_from_candidate_id,
      ]),
    ].filter((candidateId): candidateId is string => Boolean(candidateId)),
  );

  for (const candidate of activeMatchCandidates) {
    candidateMap.set(candidate.id, candidate);
  }

  const visibilityContestIds = [
    ...new Set([
      ...contestIds,
      ...Array.from(candidateMap.values()).map((candidate) => candidate.contest_id),
    ]),
  ];
  const visibilityByContest = await loadContestResultVisibilityByContest(
    supabase,
    visibilityContestIds.map((id) => ({ id })),
    { includeAdminOverride: false },
  );
  const fullResultVisibleContestIds = new Set(
    [...visibilityByContest]
      .filter(([, visibility]) => visibility.fullResultsVisible)
      .map(([contestId]) => contestId),
  );
  const weightedLoveScoreContestIds = new Set(
    [...visibilityByContest]
      .filter(([, visibility]) => visibility.showWeightedLoveScore)
      .map(([contestId]) => contestId),
  );
  const scoreByContest = await tallyVisibleContestScores(
    supabase,
    structureClient,
    [...contestById.values()],
    fullResultVisibleContestIds,
    weightedLoveScoreContestIds,
  );
  return assembleBracketImageData({
    tournament, matches: activeMatches, contests: [...contestById.values()],
    entries: (entries ?? []) as BracketEntry[], candidates: [...candidateMap.values()],
  }, visibilityByContest, scoreByContest, groupId, groupName);
}

function assembleBracketImageData(
  structure: Pick<BracketImageSnapshot, "tournament" | "matches" | "contests" | "entries" | "candidates">,
  visibilityByContest: ReadonlyMap<string, ContestResultVisibility>,
  scoreByContest: Map<string, Map<string, number>>,
  groupId: string,
  groupName: string,
): BracketImageData {
  const { tournament } = structure;
  const contestById = new Map(structure.contests.map((contest) => [contest.id, contest]));
  const activeMatches = structure.matches.filter((match) => match.contest_id && contestById.has(match.contest_id));
  const entryById = new Map(structure.entries.map((entry) => [entry.id, entry]));
  const candidateMap = new Map(structure.candidates.map((candidate) => [candidate.id, candidate]));
  const activeMatchCandidates = structure.candidates.filter((candidate) => contestById.has(candidate.contest_id));
  const fullResultVisibleContestIds = new Set([...visibilityByContest].filter(([, value]) => value.fullResultsVisible).map(([id]) => id));
  const matchCandidatesByContest = new Map<string, BracketCandidate[]>();

  for (const candidate of activeMatchCandidates) {
    const current = matchCandidatesByContest.get(candidate.contest_id) ?? [];
    current.push(candidate);
    matchCandidatesByContest.set(candidate.contest_id, current);
  }

  const canonicalResultVisibleByMatch = new Map(
    activeMatches.map((match) => {
      const contest = match.contest_id
        ? contestById.get(match.contest_id) ?? null
        : null;

      return [
        match.id,
        contest
          ? visibilityByContest.get(contest.id)?.fullResultsVisible === true
          : false,
      ] as const;
    }),
  );

  function participantSource(
    entryId: string | null,
    match: TournamentMatch,
    hiddenRoundByEntry: ReadonlyMap<string, number>,
  ) {
    const entry = entryId ? entryById.get(entryId) : null;

    if (
      !entry ||
      entryOutcomeIsHiddenInMatch(entry.id, match, hiddenRoundByEntry)
    ) {
      return null;
    }

    const contestId = match.contest_id;
    const matchCandidateId =
      contestId && matchCandidatesByContest.has(contestId)
        ? matchCandidateIdForEntry(
            entry,
            matchCandidatesByContest.get(contestId) ?? [],
            candidateMap,
          )
        : null;
    const candidate = matchCandidateId
      ? candidateMap.get(matchCandidateId) ?? null
      : candidateForEntry(entry, candidateMap);

    if (
      !candidate ||
      (candidate.contest_id !== contestId &&
        !fullResultVisibleContestIds.has(candidate.contest_id)) ||
      !inheritedCandidateIsPublic(
        candidate.id,
        candidateMap,
        fullResultVisibleContestIds,
      )
    ) {
      return null;
    }

    return { candidate, entry, matchCandidateId };
  }

  const { resultVisibleByMatch, hiddenRoundByEntry } =
    resolveBracketResultVisibility(
      activeMatches,
      canonicalResultVisibleByMatch,
      (entryId, match, hiddenRounds) =>
        participantSource(entryId, match, hiddenRounds) !== null,
    );

  function participant(
    entryId: string | null,
    match: TournamentMatch,
    resultVisible: boolean,
  ): BracketImageParticipant | null {
    const source = participantSource(entryId, match, hiddenRoundByEntry);
    if (!source) {
      return null;
    }
    const { candidate, entry, matchCandidateId } = source;
    const contestId = match.contest_id;
    const score =
      resultVisible && contestId && matchCandidateId
        ? scoreByContest.get(contestId)?.get(matchCandidateId) ?? null
        : null;

    return {
      entryId: entry.id,
      name: candidate.name,
      imagePath: candidate.image_path,
      preliminaryGroup: entry.preliminary_group,
      preliminaryRank: entry.preliminary_rank,
      screeningRank: entry.screening_rank,
      score,
      isWinner: resultVisible && match.winner_entry_id === entry.id,
    };
  }

  const bracketMatches = activeMatches
    .sort((a, b) => {
      const roundDelta =
        ROUND_ORDER.indexOf(normalizeRound(a.round) ?? "round_of_16") -
        ROUND_ORDER.indexOf(normalizeRound(b.round) ?? "round_of_16");
      return roundDelta !== 0 ? roundDelta : a.slot - b.slot;
    })
    .map((match) => {
      const round = normalizeRound(match.round) ?? "round_of_16";
      const contest = match.contest_id
        ? contestById.get(match.contest_id) ?? null
        : null;
      const resultVisible = resultVisibleByMatch.get(match.id) === true;

      return {
        id: match.id,
        round,
        roundLabel: roundLabel(round),
        slot: match.slot,
        contest: contest
          ? {
              id: contest.id,
              title: contest.title,
              status: contest.status,
            }
          : null,
        left: participant(match.left_entry_id, match, resultVisible),
        right: participant(match.right_entry_id, match, resultVisible),
        resultVisible,
        scheduledEndsAt: contest?.voting_ends_at ?? null,
        winnerEntryId: resultVisible ? match.winner_entry_id : null,
        loserEntryId: resultVisible ? match.loser_entry_id : null,
      } satisfies BracketImageMatch;
    });

  return {
    tournamentId: tournament.id,
    tournamentName: tournament.name,
    groupId,
    groupName,
    generatedAt: new Date().toISOString(),
    visibilityVersion: latestBracketVersion([
      tournament.updated_at,
      ...activeMatches.map((match) => match.updated_at),
      ...visibilityByContest.values().map(
        (visibility) => visibility.visibilityVersion,
      ),
    ]),
    matches: bracketMatches,
  };
}

export function bracketImageDataFromSnapshot(snapshot: BracketImageSnapshot, groupId: string, groupName: string) {
  const visibility = new Map(snapshot.visibility.map((row) => [row.contest_id, contestResultVisibilityFromRow(row)]));
  const weighted = new Set([...visibility].filter(([, value]) => value.showWeightedLoveScore).map(([id]) => id));
  const weight = snapshot.loveVoteWeight && snapshot.loveVoteWeight > 0 ? snapshot.loveVoteWeight : 1;
  return assembleBracketImageData(snapshot, visibility, scoresFromTallies(snapshot.tallies, weight, weighted), groupId, groupName);
}

export async function getBracketImageDataForGroup(params: {
  supabase: BracketClient;
  groupId: string;
  tournamentId?: string | null;
}) {
  const { supabase, groupId, tournamentId } = params;
  const structureClient = createServiceClient();
  if (!structureClient) {
    console.error("Bracket image structure requires the service client.");
    return null;
  }

  const { data: group } = await supabase
    .from("contest_groups")
    .select("id,name")
    .eq("id", groupId)
    .maybeSingle();

  if (!group) {
    return null;
  }

  const state = await structureClient.rpc("get_bracket_image_export_state", {
    p_group_id: groupId, p_tournament_id: tournamentId ?? null, p_include_snapshot: true,
  });
  const payload = state.data as unknown as { snapshot?: BracketImageSnapshot } | null;
  if (!state.error && payload?.snapshot) {
    return bracketImageDataFromSnapshot(payload.snapshot, groupId, group.name);
  }

  const { data: groupContests } = await supabase
    .from("contests")
    .select("id")
    .eq("group_id", groupId)
    .is("archived_at", null);
  const contestIds = (groupContests ?? []).map((contest) => contest.id);

  if (contestIds.length === 0) {
    return null;
  }

  const { data: matches } = await structureClient
    .from("tournament_matches")
    .select("tournament_id,contest_id")
    .in("contest_id", contestIds);
  const availableTournamentIds = [
    ...new Set((matches ?? []).map((match) => match.tournament_id)),
  ];

  if (availableTournamentIds.length === 0) {
    return null;
  }

  const selectedTournamentId =
    tournamentId && availableTournamentIds.includes(tournamentId)
      ? tournamentId
      : null;

  const { data: selectedTournament } = selectedTournamentId
    ? await structureClient
        .from("tournaments")
        .select("id")
        .eq("id", selectedTournamentId)
        .neq("status", "archived")
        .maybeSingle()
    : await structureClient
        .from("tournaments")
        .select("id")
        .in("id", availableTournamentIds)
        .neq("status", "archived")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

  if (!selectedTournament) {
    return null;
  }

  return loadBracketImageData({
    supabase,
    structureClient,
    tournamentId: selectedTournament.id,
    groupId,
    groupName: group.name,
  });
}
