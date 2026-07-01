import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { canViewResults } from "@/lib/contest-rules";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { tallyVotes } from "@/lib/tally";
import type {
  Candidate,
  Contest,
  Database,
  LoveVoteAllocation,
  Tournament,
  TournamentEntry,
  TournamentMatch,
  Vote,
} from "@/lib/types";

type BracketClient = SupabaseClient<Database>;

type BracketContest = Pick<
  Contest,
  | "id"
  | "title"
  | "status"
  | "vote_type"
  | "group_id"
  | "live_results_enabled"
  | "closed_result_visibility"
  | "voting_starts_at"
  | "voting_ends_at"
  | "archived_at"
  | "created_at"
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

type PublicVoteRow = Pick<Vote, "id" | "contest_id" | "payload" | "created_at">;
type PublicLoveVoteRow = Pick<
  LoveVoteAllocation,
  "vote_id" | "candidate_id" | "contest_id"
>;

type BracketTournament = Pick<
  Tournament,
  "id" | "name" | "status" | "created_at" | "updated_at"
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

export type TournamentBracketParticipant = {
  entryId: string;
  name: string;
  imagePath: string | null;
  seedLabel: string | null;
  score: number | null;
  isWinner: boolean;
};

export type TournamentBracketMatch = {
  id: string;
  round: string;
  roundLabel: string;
  slot: number;
  contest: BracketContest | null;
  left: TournamentBracketParticipant | null;
  right: TournamentBracketParticipant | null;
  resultVisible: boolean;
  winnerEntryId: string | null;
  loserEntryId: string | null;
};

export type TournamentBracketRound = {
  key: string;
  label: string;
  matches: TournamentBracketMatch[];
};

export type TournamentBracketData = {
  tournament: BracketTournament;
  groupId: string | null;
  rounds: TournamentBracketRound[];
  hasVotingMatch: boolean;
};

const ROUND_ORDER = [
  "round_of_16",
  "quarterfinal",
  "semifinal",
  "final",
  "third_place",
] as const;

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

function seedLabel(entry: BracketEntry) {
  const parts: string[] = [];

  if (entry.preliminary_group) {
    parts.push(`${entry.preliminary_group} 组`);
  }
  if (typeof entry.preliminary_rank === "number") {
    parts.push(`预赛第 ${entry.preliminary_rank}`);
  } else if (entry.is_group_winner) {
    parts.push("小组第一");
  }
  if (typeof entry.screening_rank === "number") {
    parts.push(`海选第 ${entry.screening_rank}`);
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

function lineage(candidateId: string | null | undefined, candidates: Map<string, BracketCandidate>) {
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
  contests: BracketContest[],
  forceVisibleContestIds: ReadonlySet<string> = new Set(),
) {
  const scores = new Map<string, Map<string, number>>();
  const visibleContests = contests.filter(
    (contest) =>
      canViewResults(contest, null) || forceVisibleContestIds.has(contest.id),
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
      ? await supabase
          .from("contest_groups")
          .select("id,love_vote_weight")
          .in("id", groupIds)
      : { data: [] };
  const loveVoteWeightByGroup = new Map(
    (groups ?? []).map((group) => [group.id, Number(group.love_vote_weight)]),
  );
  const serviceSupabase = createServiceClient();

  if (!serviceSupabase) {
    console.error("Tournament bracket scores require the service client.");
    return scores;
  }

  const [
    { data: candidates, error: candidatesError },
    { data: voteRows, error: voteRowsError },
    { data: loveRows, error: loveRowsError },
  ] = await Promise.all([
    serviceSupabase
      .from("candidates")
      .select(
        "id,contest_id,name,description,image_path,nominator_display_name,is_active,created_at",
      )
      .in("contest_id", visibleContestIds)
      .eq("is_active", true)
      .order("created_at", { ascending: true }),
    fetchAllRows<PublicVoteRow>(() =>
      serviceSupabase
        .from("votes")
        .select("id,contest_id,payload,created_at")
        .in("contest_id", visibleContestIds)
        .order("created_at", { ascending: true }),
    ),
    fetchAllRows<PublicLoveVoteRow>(() =>
      serviceSupabase
        .from("love_vote_allocations")
        .select("vote_id,candidate_id,contest_id")
        .in("contest_id", visibleContestIds),
    ),
  ]);

  if (candidatesError || voteRowsError || loveRowsError) {
    console.error(
      "Failed to load tournament bracket scores.",
      candidatesError?.message ?? voteRowsError?.message ?? loveRowsError?.message,
    );
    return scores;
  }

  const candidatesByContest = new Map<string, BracketCandidate[]>();
  for (const candidate of (candidates ?? []) as BracketCandidate[]) {
    const current = candidatesByContest.get(candidate.contest_id) ?? [];
    current.push(candidate);
    candidatesByContest.set(candidate.contest_id, current);
  }

  const votesByContest = new Map<string, PublicVoteRow[]>();
  for (const vote of (voteRows ?? []) as PublicVoteRow[]) {
    const current = votesByContest.get(vote.contest_id) ?? [];
    current.push(vote);
    votesByContest.set(vote.contest_id, current);
  }

  const loveRowsByContest = new Map<string, PublicLoveVoteRow[]>();
  for (const loveRow of (loveRows ?? []) as PublicLoveVoteRow[]) {
    const current = loveRowsByContest.get(loveRow.contest_id) ?? [];
    current.push(loveRow);
    loveRowsByContest.set(loveRow.contest_id, current);
  }

  for (const contest of visibleContests) {
    scores.set(
      contest.id,
      new Map(
        tallyVotes({
          voteType: contest.vote_type,
          candidates: candidatesByContest.get(contest.id) ?? [],
          votes: (votesByContest.get(contest.id) ?? []).map((vote) => ({
            ...vote,
            voter_id: null,
          })),
          loveVoteWeight: contest.group_id
            ? loveVoteWeightByGroup.get(contest.group_id) ?? null
            : null,
          loveVoteScoreMode: contest.status === "published" ? "weighted" : "base",
          loveAllocations: loveRowsByContest.get(contest.id) ?? [],
        }).map((result) => [result.candidateId, result.score]),
      ),
    );
  }

  return scores;
}

async function loadTournamentBracket(
  supabase: BracketClient,
  tournamentId: string,
): Promise<TournamentBracketData | null> {
  const [{ data: tournament }, { data: matches }] = await Promise.all([
    supabase
      .from("tournaments")
      .select("id,name,status,created_at,updated_at")
      .eq("id", tournamentId)
      .neq("status", "archived")
      .maybeSingle(),
    supabase
      .from("tournament_matches")
      .select(
        "id,tournament_id,stage_id,contest_id,round,slot,left_entry_id,right_entry_id,winner_entry_id,loser_entry_id,metadata,created_at,updated_at",
      )
      .eq("tournament_id", tournamentId),
  ]);

  if (!tournament) {
    return null;
  }

  const rawMatches = ((matches ?? []) as TournamentMatch[]).filter(
    (match) => match.contest_id,
  );
  const contestIds = [
    ...new Set(
      rawMatches
        .map((match) => match.contest_id)
        .filter((contestId): contestId is string => Boolean(contestId)),
    ),
  ];

  if (contestIds.length === 0) {
    return {
      tournament: tournament as BracketTournament,
      groupId: null,
      rounds: [],
      hasVotingMatch: false,
    };
  }

  const { data: contests } = await supabase
    .from("contests")
    .select(
      "id,title,status,vote_type,group_id,live_results_enabled,closed_result_visibility,voting_starts_at,voting_ends_at,archived_at,created_at",
    )
    .in("id", contestIds)
    .is("archived_at", null);
  const activeContests = (contests ?? []) as BracketContest[];
  const groupIds = [
    ...new Set(
      activeContests
        .map((contest) => contest.group_id)
        .filter((groupId): groupId is string => Boolean(groupId)),
    ),
  ];
  const contestById = new Map(
    activeContests.map((contest) => [contest.id, contest]),
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
      ? await supabase
          .from("tournament_entries")
          .select(
            "id,root_candidate_id,current_candidate_id,source_candidate_id,screening_rank,preliminary_group,preliminary_rank,is_group_winner,status",
          )
          .in("id", entryIds)
      : { data: [] };
  const entryById = new Map(
    ((entries ?? []) as BracketEntry[]).map((entry) => [entry.id, entry]),
  );
  const { data: matchCandidates } =
    contestIds.length > 0
      ? await supabase
          .from("candidates")
          .select(
            "id,contest_id,name,description,image_path,nominator_display_name,inherited_from_candidate_id,is_active,created_at",
          )
          .in("contest_id", contestIds)
          .eq("is_active", true)
      : { data: [] };
  const activeMatchCandidates = (matchCandidates ?? []) as BracketCandidate[];
  const candidateMap = await fetchCandidateLineage(supabase, [
    ...candidateIdsFromEntries((entries ?? []) as BracketEntry[]),
    ...activeMatchCandidates.flatMap((candidate) => [
      candidate.id,
      candidate.inherited_from_candidate_id,
    ]),
  ].filter((candidateId): candidateId is string => Boolean(candidateId)));

  for (const candidate of activeMatchCandidates) {
    candidateMap.set(candidate.id, candidate);
  }

  const forceVisibleContestIds = new Set(
    tournament.status === "completed"
      ? activeMatches
          .filter((match) => match.winner_entry_id && match.loser_entry_id)
          .map((match) => match.contest_id)
          .filter((contestId): contestId is string => Boolean(contestId))
      : [],
  );
  const scoreByContest = await tallyVisibleContestScores(
    supabase,
    [...contestById.values()],
    forceVisibleContestIds,
  );
  const matchCandidatesByContest = new Map<string, BracketCandidate[]>();

  for (const candidate of activeMatchCandidates) {
    const current = matchCandidatesByContest.get(candidate.contest_id) ?? [];
    current.push(candidate);
    matchCandidatesByContest.set(candidate.contest_id, current);
  }

  function participant(
    entryId: string | null,
    match: TournamentMatch,
  ): TournamentBracketParticipant | null {
    const entry = entryId ? entryById.get(entryId) : null;
    const candidate = candidateForEntry(entry, candidateMap);

    if (!entry || !candidate) {
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
    const score =
      contestId && matchCandidateId
        ? scoreByContest.get(contestId)?.get(matchCandidateId) ?? null
        : null;

    return {
      entryId: entry.id,
      name: candidate.name,
      imagePath: candidate.image_path,
      seedLabel: seedLabel(entry),
      score,
      isWinner: match.winner_entry_id === entry.id,
    };
  }

  const rounds = ROUND_ORDER.map((round) => {
    const roundMatches = activeMatches
      .filter((match) => match.round === round)
      .sort((a, b) => a.slot - b.slot)
      .map((match) => {
        const contest = match.contest_id
          ? contestById.get(match.contest_id) ?? null
          : null;
        const resultVisible = contest
          ? canViewResults(contest, null) || forceVisibleContestIds.has(contest.id)
          : false;

        return {
          id: match.id,
          round: match.round,
          roundLabel: roundLabel(match.round),
          slot: match.slot,
          contest,
          left: participant(match.left_entry_id, match),
          right: participant(match.right_entry_id, match),
          resultVisible,
          winnerEntryId: resultVisible ? match.winner_entry_id : null,
          loserEntryId: resultVisible ? match.loser_entry_id : null,
        } satisfies TournamentBracketMatch;
      });

    return {
      key: round,
      label: roundLabel(round),
      matches: roundMatches,
    };
  }).filter((round) => round.matches.length > 0);

  return {
    tournament: tournament as BracketTournament,
    groupId: groupIds[0] ?? null,
    rounds,
    hasVotingMatch: [...contestById.values()].some(
      (contest) => contest.status === "voting",
    ),
  };
}

export async function getTournamentBracket(
  supabase: BracketClient,
  tournamentId: string,
) {
  try {
    return await loadTournamentBracket(supabase, tournamentId);
  } catch (error) {
    console.error("Failed to load tournament bracket.", error);
    return null;
  }
}

export async function getTournamentBracketsForGroup(
  supabase: BracketClient,
  groupId: string,
) {
  const { data: groupContests } = await supabase
    .from("contests")
    .select("id,status,created_at")
    .eq("group_id", groupId)
    .is("archived_at", null);
  const contestIds = (groupContests ?? []).map((contest) => contest.id);

  if (contestIds.length === 0) {
    return [];
  }

  const { data: matches } = await supabase
    .from("tournament_matches")
    .select("tournament_id,contest_id")
    .in("contest_id", contestIds);
  const tournamentIds = [
    ...new Set(
      (matches ?? [])
        .filter((match) => match.contest_id)
        .map((match) => match.tournament_id),
    ),
  ];

  if (tournamentIds.length === 0) {
    return [];
  }

  const { data: tournament } = await supabase
    .from("tournaments")
    .select("id")
    .in("id", tournamentIds)
    .neq("status", "archived")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!tournament) {
    return [];
  }

  const bracket = await getTournamentBracket(supabase, tournament.id);

  return bracket && bracket.rounds.length > 0 ? [bracket] : [];
}
