import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  buildKnockoutBracket,
  resolveKnockoutMatch,
  resolvePreliminaryGroup,
} from "../lib/tournament-rules.ts";
import { tallyVotes } from "../lib/tally.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_ENV_FILE = path.join(ROOT, ".local", "supabase-app.env");
const MOCK_PURPOSE = "full-tournament-simulation";
const DEFAULT_VOTER_COUNT = 64;
const CONCURRENCY = 8;
const PRELIMINARY_GROUPS = ["A", "B", "C", "D"];
const ROUND_ORDER = [
  "round_of_16",
  "quarterfinal",
  "semifinal",
  "final",
  "third_place",
];
const KNOCKOUT_ROUND_MATCH_COUNTS = Object.freeze({
  round_of_16: 8,
  quarterfinal: 4,
  semifinal: 2,
  final: 1,
  third_place: 1,
});
const TIE_ELIGIBLE_ROUNDS = ["round_of_16", "quarterfinal", "semifinal"];

function parseEnvFile(filePath) {
  return Object.fromEntries(
    readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

export function parseArgs(argv) {
  const options = {
    tournamentId: null,
    voters: DEFAULT_VOTER_COUNT,
    envFile: DEFAULT_ENV_FILE,
    stopAtSemifinalVoting: false,
    tieRound: null,
    tieSlot: null,
    withLoveVotes: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--tournament-id") {
      options.tournamentId = argv[++index] ?? null;
    } else if (argument === "--voters") {
      options.voters = Number(argv[++index]);
    } else if (argument === "--env-file") {
      options.envFile = path.resolve(ROOT, argv[++index] ?? "");
    } else if (argument === "--stop-at-semifinal-voting") {
      options.stopAtSemifinalVoting = true;
    } else if (argument === "--with-love-votes") {
      options.withLoveVotes = true;
    } else if (argument === "--tie-round") {
      options.tieRound = argv[++index] ?? null;
    } else if (argument === "--tie-slot") {
      options.tieSlot = Number(argv[++index]);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (
    !options.tournamentId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      options.tournamentId,
    )
  ) {
    throw new Error("Provide a valid UUID with --tournament-id.");
  }
  if (!Number.isInteger(options.voters) || options.voters < 16 || options.voters > 200) {
    throw new Error("--voters must be an integer between 16 and 200.");
  }
  if ((options.tieRound === null) !== (options.tieSlot === null)) {
    throw new Error("--tie-round and --tie-slot must be provided together.");
  }
  if (options.tieRound && !TIE_ELIGIBLE_ROUNDS.includes(options.tieRound)) {
    throw new Error("--tie-round must be round_of_16, quarterfinal, or semifinal.");
  }
  if (options.tieRound) {
    const maxTieSlot = KNOCKOUT_ROUND_MATCH_COUNTS[options.tieRound];
    if (
      !Number.isInteger(options.tieSlot) ||
      options.tieSlot < 1 ||
      options.tieSlot > maxTieSlot
    ) {
      throw new Error(
        `--tie-slot must be an integer between 1 and ${maxTieSlot} for ${options.tieRound}.`,
      );
    }
    if (options.voters % 2 !== 0) {
      throw new Error("--voters must be even when requesting a tied knockout match.");
    }
  }
  if (options.stopAtSemifinalVoting && !options.tieRound) {
    throw new Error("The semifinal-voting test case requires --tie-round and --tie-slot.");
  }
  return options;
}

export function assertLoopbackSupabaseUrl(value) {
  const url = new URL(value);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error(`Refusing to simulate a tournament on non-local Supabase: ${url.origin}`);
  }
  return url;
}

function hashSeed(value) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function buildStrictDescendingScores(candidateCount, voterCount, maxChoices) {
  if (
    !Number.isInteger(candidateCount) ||
    !Number.isInteger(voterCount) ||
    !Number.isInteger(maxChoices) ||
    candidateCount < 1 ||
    voterCount < 1 ||
    maxChoices < 1
  ) {
    throw new Error("Candidate, voter, and max-choice counts must be positive integers.");
  }

  const triangular = (candidateCount * (candidateCount - 1)) / 2;
  const maximum = Math.min(
    voterCount,
    Math.floor((voterCount * maxChoices + triangular) / candidateCount),
  );
  const scores = Array.from({ length: candidateCount }, (_, index) => maximum - index);
  if (scores.at(-1) < 1 || scores.reduce((sum, score) => sum + score, 0) < voterCount) {
    throw new Error("The requested vote limits cannot produce a non-empty strict ranking.");
  }
  return scores;
}

export function buildBoundedApprovalMatrix(
  candidateIds,
  targetScores,
  voterCount,
  maxChoices,
  seed,
) {
  if (candidateIds.length !== targetScores.length) {
    throw new Error("Candidate and score counts differ.");
  }
  if (
    targetScores.some((score) => !Number.isInteger(score) || score < 1 || score > voterCount) ||
    targetScores.reduce((sum, score) => sum + score, 0) > voterCount * maxChoices
  ) {
    throw new Error("Target scores exceed the approval-vote capacity.");
  }

  const selections = Array.from({ length: voterCount }, () => []);
  const loads = Array(voterCount).fill(0);
  const seedHash = hashSeed(seed);

  candidateIds.forEach((candidateId, candidateIndex) => {
    const offset = (seedHash + candidateIndex * 17) % voterCount;
    const voters = Array.from({ length: voterCount }, (_, voterIndex) => voterIndex)
      .sort((left, right) => {
        const byLoad = loads[left] - loads[right];
        if (byLoad !== 0) return byLoad;
        const leftOrder = (left - offset + voterCount) % voterCount;
        const rightOrder = (right - offset + voterCount) % voterCount;
        return leftOrder - rightOrder;
      })
      .slice(0, targetScores[candidateIndex]);

    for (const voterIndex of voters) {
      if (loads[voterIndex] >= maxChoices) {
        throw new Error("Unable to distribute approvals within max_choices.");
      }
      selections[voterIndex].push(candidateId);
      loads[voterIndex] += 1;
    }
  });

  if (selections.some((selection) => selection.length < 1 || selection.length > maxChoices)) {
    throw new Error("Every simulated voter must make between 1 and max_choices selections.");
  }
  return selections;
}

export function nextRoundPlan(sourceRound) {
  if (sourceRound === "round_of_16") {
    return {
      targetRound: "quarterfinal",
      targets: [1, 2, 3, 4].map((slot) => ({
        round: "quarterfinal",
        slot,
        sourceSlots: [slot * 2 - 1, slot * 2],
        participant: "winner",
      })),
    };
  }
  if (sourceRound === "quarterfinal") {
    return {
      targetRound: "semifinal",
      targets: [1, 2].map((slot) => ({
        round: "semifinal",
        slot,
        sourceSlots: [slot * 2 - 1, slot * 2],
        participant: "winner",
      })),
    };
  }
  if (sourceRound === "semifinal") {
    return {
      targetRound: "final",
      targets: [
        { round: "final", slot: 1, sourceSlots: [1, 2], participant: "winner" },
        { round: "third_place", slot: 1, sourceSlots: [1, 2], participant: "loser" },
      ],
    };
  }
  throw new Error(`No follow-up round exists after ${sourceRound}.`);
}

async function mapWithConcurrency(values, concurrency, task) {
  const results = new Array(values.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await task(values[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker()),
  );
  return results;
}

async function listAllAuthUsers(supabase) {
  const users = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
}

function isTournamentMockUser(user, tournamentId) {
  return (
    user.user_metadata?.purpose === MOCK_PURPOSE &&
    user.user_metadata?.tournament_id === tournamentId
  );
}

async function ensureMockUsers(supabase, tournamentId, voterCount) {
  const existing = (await listAllAuthUsers(supabase))
    .filter((user) => isTournamentMockUser(user, tournamentId))
    .sort((left, right) => left.email.localeCompare(right.email));
  if (existing.length > voterCount) {
    throw new Error(`Found ${existing.length} tournament mock users; expected at most ${voterCount}.`);
  }

  const existingByEmail = new Map(existing.map((user) => [user.email, user]));
  const prefix = `tournament-${tournamentId.slice(0, 8)}-voter-`;
  const users = await mapWithConcurrency(
    Array.from({ length: voterCount }, (_, index) => index),
    CONCURRENCY,
    async (index) => {
      const email = `${prefix}${String(index + 1).padStart(3, "0")}@buttervote.local`;
      const current = existingByEmail.get(email);
      if (current) return current;
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password: "ButterVoteTournamentMock123!",
        email_confirm: true,
        user_metadata: {
          display_name: `Tournament Mock Voter ${String(index + 1).padStart(3, "0")}`,
          purpose: MOCK_PURPOSE,
          tournament_id: tournamentId,
        },
      });
      if (error || !data.user) {
        throw new Error(`Failed to create ${email}: ${error?.message ?? "unknown error"}`);
      }
      return data.user;
    },
  );
  return users;
}

async function loadContestBundle(supabase, contestId) {
  const [{ data: contest, error: contestError }, { data: candidates, error: candidateError }] =
    await Promise.all([
      supabase
        .from("contests")
        .select("id,title,status,vote_type,max_choices,require_exact_choices,group_id,love_vote_enabled,archived_at")
        .eq("id", contestId)
        .single(),
      supabase
        .from("candidates")
        .select(
          "id,name,description,image_path,nominator_display_name,is_active,inherited_from_candidate_id,created_at",
        )
        .eq("contest_id", contestId)
        .eq("is_active", true)
        .order("created_at", { ascending: true }),
    ]);
  if (contestError) throw contestError;
  if (candidateError) throw candidateError;
  if (contest.archived_at) throw new Error(`${contest.title} is archived.`);
  return { contest, candidates: candidates ?? [] };
}

async function loadVotes(supabase, contestId) {
  const { data, error } = await supabase
    .from("votes")
    .select("id,contest_id,voter_id,payload,created_at")
    .eq("contest_id", contestId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

async function tallyContest(supabase, contestId) {
  const [{ contest, candidates }, votes, loveRows] = await Promise.all([
    loadContestBundle(supabase, contestId),
    loadVotes(supabase, contestId),
    supabase
      .from("love_vote_allocations")
      .select("vote_id,candidate_id,contest_id")
      .eq("contest_id", contestId)
      .then(({ data, error }) => {
        if (error) throw error;
        return data ?? [];
      }),
  ]);
  let loveVoteWeight = null;
  if (contest.group_id) {
    const { data: group, error } = await supabase
      .from("contest_groups")
      .select("love_vote_weight")
      .eq("id", contest.group_id)
      .single();
    if (error) throw error;
    loveVoteWeight = Number(group.love_vote_weight);
  }
  return {
    contest,
    candidates,
    votes,
    loveRows,
    loveVoteWeight,
    results: tallyVotes({
      voteType: contest.vote_type,
      candidates,
      votes,
      loveVoteWeight,
      loveAllocations: loveRows,
    }),
  };
}

async function deleteMockVotes(supabase, contestId, userIds) {
  for (let index = 0; index < userIds.length; index += 100) {
    const { error } = await supabase
      .from("votes")
      .delete()
      .eq("contest_id", contestId)
      .in("voter_id", userIds.slice(index, index + 100));
    if (error) throw error;
  }
}

async function simulateContest(
  supabase,
  users,
  contestId,
  selections,
  expectedScores,
  { loveCandidateIdsByVoter = [], close = true } = {},
) {
  const userIds = users.map((user) => user.id);
  const userIdSet = new Set(userIds);
  const before = await loadContestBundle(supabase, contestId);
  const existingVotes = await loadVotes(supabase, contestId);
  const nonMockVotes = existingVotes.filter((vote) => !userIdSet.has(vote.voter_id));
  if (nonMockVotes.length > 0) {
    throw new Error(`${before.contest.title} contains ${nonMockVotes.length} non-mock votes.`);
  }

  if (
    existingVotes.length === users.length &&
    ["closed", "published"].includes(before.contest.status) &&
    close
  ) {
    const existingBundle = await tallyContest(supabase, contestId);
    verifyExpectedScores(existingBundle, expectedScores);
    return existingBundle;
  }

  if (!["draft", "voting", "closed", "published"].includes(before.contest.status)) {
    throw new Error(`${before.contest.title} has unsupported status ${before.contest.status}.`);
  }
  if (selections.length !== users.length) {
    throw new Error(`Selection count does not match voter count for ${before.contest.title}.`);
  }

  await deleteMockVotes(supabase, contestId, userIds);
  const { error: votingError } = await supabase
    .from("contests")
    .update({ status: "voting" })
    .eq("id", contestId);
  if (votingError) throw votingError;

  await mapWithConcurrency(users, CONCURRENCY, async (user, index) => {
    const payload =
      before.contest.vote_type === "single"
        ? { candidateId: selections[index][0] }
        : { candidateIds: selections[index] };
    const { error } = await supabase.rpc("submit_vote_with_love", {
      p_contest_id: contestId,
      p_voter_id: user.id,
      p_payload: payload,
      p_love_candidate_ids: loveCandidateIdsByVoter[index] ?? [],
    });
    if (error) throw new Error(`${before.contest.title}, voter ${index + 1}: ${error.message}`);
  });

  if (close) {
    const { error: closeError } = await supabase
      .from("contests")
      .update({ status: "closed" })
      .eq("id", contestId);
    if (closeError) throw closeError;
  }

  const bundle = await tallyContest(supabase, contestId);
  if (bundle.votes.length !== users.length) {
    throw new Error(`${before.contest.title} expected ${users.length} votes, got ${bundle.votes.length}.`);
  }
  verifyExpectedScores(bundle, expectedScores);
  return bundle;
}

function verifyExpectedScores(bundle, expectedScores) {
  if (!expectedScores) return;
  const actualById = new Map(bundle.results.map((result) => [result.candidateId, result.score]));
  const mismatch = bundle.candidates.find(
    (candidate) => actualById.get(candidate.id) !== expectedScores.get(candidate.id),
  );
  if (mismatch) throw new Error(`${bundle.contest.title} score verification failed for ${mismatch.name}.`);
}

async function simulatePreliminaries(supabase, users, tournamentId) {
  const { data: stages, error } = await supabase
    .from("tournament_stages")
    .select("id,contest_id,group_id,sequence,metadata")
    .eq("tournament_id", tournamentId)
    .eq("kind", "preliminary")
    .order("sequence", { ascending: true });
  if (error) throw error;
  if (stages?.length !== 4 || stages.some((stage) => !stage.contest_id)) {
    throw new Error("The tournament must have four generated preliminary contests.");
  }

  const bundles = [];
  for (const stage of stages) {
    const group = stage.metadata?.preliminaryGroup;
    if (!PRELIMINARY_GROUPS.includes(group)) throw new Error("Invalid preliminary group metadata.");
    const { contest, candidates } = await loadContestBundle(supabase, stage.contest_id);
    if (contest.vote_type !== "multiple" || contest.max_choices !== 4 || candidates.length !== 12) {
      throw new Error(`${contest.title} does not match the expected 12-candidate, max-4 format.`);
    }
    const orderedCandidates = [...candidates].sort((left, right) =>
      left.name.localeCompare(right.name, "zh-Hans", { numeric: true }),
    );
    const scores = buildStrictDescendingScores(orderedCandidates.length, users.length, 4);
    const selections = buildBoundedApprovalMatrix(
      orderedCandidates.map((candidate) => candidate.id),
      scores,
      users.length,
      4,
      `${tournamentId}:preliminary:${group}`,
    );
    const bundle = await simulateContest(
      supabase,
      users,
      stage.contest_id,
      selections,
      new Map(orderedCandidates.map((candidate, index) => [candidate.id, scores[index]])),
    );
    console.log(`Closed preliminary ${group}: ${bundle.results[0].name} leads with ${bundle.results[0].score}.`);
    bundles.push({ group, stage, ...bundle });
  }
  return bundles.sort((left, right) => left.group.localeCompare(right.group));
}

async function generateRoundOf16(
  supabase,
  tournament,
  preliminaryBundles,
  targetGroupId = null,
) {
  const { data: existing, error: existingError } = await supabase
    .from("tournament_matches")
    .select("id")
    .eq("tournament_id", tournament.id)
    .eq("round", "round_of_16");
  if (existingError) throw existingError;
  if (existing?.length === 8) return;
  if (existing?.length) throw new Error("Incomplete existing Ro16 draw detected.");

  const { data: entries, error: entryError } = await supabase
    .from("tournament_entries")
    .select("*")
    .eq("tournament_id", tournament.id);
  if (entryError) throw entryError;
  const entryByCandidateId = new Map(entries.map((entry) => [entry.current_candidate_id, entry]));
  const selected = [];

  for (const bundle of preliminaryBundles) {
    const screeningRanks = new Map();
    for (const candidate of bundle.candidates) {
      const entry = entryByCandidateId.get(candidate.id);
      if (!entry) throw new Error(`Missing tournament entry for ${candidate.name}.`);
      screeningRanks.set(candidate.id, entry.screening_rank);
    }
    const resolution = resolvePreliminaryGroup(bundle.results, screeningRanks, 4);
    if (resolution.needsTiebreaker || resolution.advancers.length !== 4) {
      throw new Error(`Preliminary ${bundle.group} unexpectedly requires a tiebreaker.`);
    }
    resolution.advancers.forEach((result, index) => {
      const entry = entryByCandidateId.get(result.candidateId);
      selected.push({
        candidateId: entry.id,
        entryId: entry.id,
        currentCandidateId: entry.current_candidate_id,
        preliminaryGroup: bundle.group,
        preliminaryRank: index + 1,
        isGroupWinner: index === 0,
        score: result.score,
        lastVoteAt: result.lastVoteAt,
        name: result.name,
      });
    });
  }

  const groupWinners = Object.fromEntries(
    selected.filter((entry) => entry.isGroupWinner).map((entry) => [entry.preliminaryGroup, entry]),
  );
  const others = selected.filter((entry) => !entry.isGroupWinner);
  const seed = `simulation:${tournament.id}:round-of-16`;
  const bracket = buildKnockoutBracket(groupWinners, others, seed);
  const entriesPayload = selected.map((entry) => ({
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
    tournamentId: tournament.id,
    finalists: selected.map((entry) => ({
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
  const { error } = await supabase.rpc("create_knockout_stage_atomic", {
    p_tournament_id: tournament.id,
    p_target_group_id: targetGroupId,
    p_seed: seed,
    p_input: input,
    p_output: output,
    p_entries: entriesPayload,
    p_matches: matchesPayload,
    p_created_by: tournament.created_by,
  });
  if (error) throw error;
  if (targetGroupId) {
    const matches = await getRoundMatches(supabase, tournament.id, "round_of_16");
    const { error: loveError } = await supabase
      .from("contests")
      .update({ love_vote_enabled: true })
      .in("id", matches.map((match) => match.contest_id));
    if (loveError) throw loveError;
  }
  console.log("Generated 8 Ro16 contests through create_knockout_stage_atomic.");
}

async function getRoundMatches(supabase, tournamentId, round) {
  const { data, error } = await supabase
    .from("tournament_matches")
    .select("*")
    .eq("tournament_id", tournamentId)
    .eq("round", round)
    .order("slot", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

async function simulateKnockoutRound(
  supabase,
  users,
  tournamentId,
  round,
  { tieSlot = null, withLoveVotes = false, close = true } = {},
) {
  const matches = await getRoundMatches(supabase, tournamentId, round);
  const expected = KNOCKOUT_ROUND_MATCH_COUNTS[round];
  if (matches.length !== expected) throw new Error(`${round} expected ${expected} matches.`);
  if (tieSlot !== null && !matches.some((match) => match.slot === tieSlot)) {
    throw new Error(`${round} has no match in slot ${tieSlot}.`);
  }

  for (const match of matches) {
    if (!match.contest_id) throw new Error(`${round} slot ${match.slot} has no contest.`);
    const { contest, candidates } = await loadContestBundle(supabase, match.contest_id);
    if (contest.vote_type !== "single" || candidates.length !== 2) {
      throw new Error(`${contest.title} is not a two-candidate single-choice contest.`);
    }
    const winnerIndex = hashSeed(`${tournamentId}:${round}:${match.slot}`) % 2;
    const winnerId = candidates[winnerIndex].id;
    const loserId = candidates[1 - winnerIndex].id;
    const isTie = match.slot === tieSlot;
    const winnerVotes = isTie ? users.length / 2 : Math.floor(users.length * 0.625);
    if (!Number.isInteger(winnerVotes)) {
      throw new Error("A tied knockout match requires an even voter count.");
    }
    const selections = Array.from({ length: users.length }, (_, index) => [
      index < winnerVotes ? winnerId : loserId,
    ]);
    const loveCandidateIdsByVoter = Array.from({ length: users.length }, () => []);
    if (withLoveVotes) {
      loveCandidateIdsByVoter[0] = [winnerId];
      loveCandidateIdsByVoter[winnerVotes] = [loserId];
    }
    const bundle = await simulateContest(
      supabase,
      users,
      match.contest_id,
      selections,
      null,
      { loveCandidateIdsByVoter, close },
    );
    if (isTie && bundle.results[0]?.score !== bundle.results[1]?.score) {
      throw new Error(`${contest.title} was expected to be tied after love-vote weighting.`);
    }
    const state = close ? "Closed" : "Voting";
    console.log(
      `${state} ${round} #${match.slot}: ${bundle.results[0].name} ${bundle.results[0].score}-${bundle.results[1].score} ${bundle.results[1].name}${isTie ? " (tie)" : ""}.`,
    );
  }
}

async function resolveRound(supabase, tournamentId, round) {
  const [matches, entriesResult] = await Promise.all([
    getRoundMatches(supabase, tournamentId, round),
    supabase.from("tournament_entries").select("*").eq("tournament_id", tournamentId),
  ]);
  if (entriesResult.error) throw entriesResult.error;
  const entries = entriesResult.data ?? [];
  const resolutions = [];

  for (const match of matches) {
    const bundle = await tallyContest(supabase, match.contest_id);
    if (!["closed", "published"].includes(bundle.contest.status)) {
      throw new Error(`${bundle.contest.title} is not closed.`);
    }
    const entryByCandidateId = new Map();
    for (const candidate of bundle.candidates) {
      const entry = entries.find((item) => item.current_candidate_id === candidate.id);
      if (!entry) throw new Error(`Cannot map ${candidate.name} to a tournament entry.`);
      entryByCandidateId.set(candidate.id, entry);
    }
    const matchResults = bundle.results.map((result) => ({
      ...result,
      entryId: entryByCandidateId.get(result.candidateId).id,
    }));
    const screeningRankByCandidate = new Map(
      matchResults.map((result) => [
        result.candidateId,
        entries.find((entry) => entry.id === result.entryId)?.screening_rank ??
          Number.POSITIVE_INFINITY,
      ]),
    );
    const leftEntry = entries.find((entry) => entry.id === match.left_entry_id);
    const rightEntry = entries.find((entry) => entry.id === match.right_entry_id);
    let headToHeadWinnerId = null;
    if (
      leftEntry?.preliminary_group &&
      leftEntry.preliminary_group === rightEntry?.preliminary_group &&
      typeof leftEntry.preliminary_rank === "number" &&
      typeof rightEntry.preliminary_rank === "number" &&
      leftEntry.preliminary_rank !== rightEntry.preliminary_rank
    ) {
      const headToHeadEntry =
        leftEntry.preliminary_rank < rightEntry.preliminary_rank ? leftEntry : rightEntry;
      headToHeadWinnerId = matchResults.find(
        (result) => result.entryId === headToHeadEntry.id,
      )?.candidateId ?? null;
    }
    const resolution = resolveKnockoutMatch(matchResults, {
      headToHeadWinnerId,
      screeningRankByCandidate,
      seed: `simulation:${tournamentId}:${round}:${match.slot}`,
    });
    if (!resolution.winner || !resolution.loser) throw new Error(`Cannot resolve ${round} #${match.slot}.`);
    resolutions.push({
      matchId: match.id,
      slot: match.slot,
      winnerEntryId: resolution.winner.entryId,
      loserEntryId: resolution.loser.entryId,
      winnerCandidateId: resolution.winner.candidateId,
      loserCandidateId: resolution.loser.candidateId,
    });
  }
  return resolutions;
}

async function publishRound(supabase, tournamentId, round) {
  const matches = await getRoundMatches(supabase, tournamentId, round);
  const contestIds = matches.map((match) => match.contest_id).filter(Boolean);
  if (contestIds.length === 0) return;
  const { error } = await supabase
    .from("contests")
    .update({ status: "published" })
    .in("id", contestIds)
    .eq("status", "closed");
  if (error) throw error;
}

async function publishPreliminaries(supabase, tournamentId) {
  const { data: stages, error } = await supabase
    .from("tournament_stages")
    .select("contest_id")
    .eq("tournament_id", tournamentId)
    .eq("kind", "preliminary");
  if (error) throw error;
  const contestIds = (stages ?? []).map((stage) => stage.contest_id).filter(Boolean);
  const { error: publishError } = await supabase
    .from("contests")
    .update({ status: "published" })
    .in("id", contestIds)
    .eq("status", "closed");
  if (publishError) throw publishError;
}

async function verifySemifinalVotingCase(supabase, tournamentId, tieRound, tieSlot) {
  const [allMatches, semifinalMatches, tieMatches] = await Promise.all([
    getRoundMatches(supabase, tournamentId, "round_of_16").then(async (roundOf16) => [
      ...roundOf16,
      ...(await getRoundMatches(supabase, tournamentId, "quarterfinal")),
      ...(await getRoundMatches(supabase, tournamentId, "semifinal")),
      ...(await getRoundMatches(supabase, tournamentId, "final")),
      ...(await getRoundMatches(supabase, tournamentId, "third_place")),
    ]),
    getRoundMatches(supabase, tournamentId, "semifinal"),
    getRoundMatches(supabase, tournamentId, tieRound),
  ]);
  if (allMatches.length !== 14) throw new Error(`Expected 14 matches, found ${allMatches.length}.`);
  if (semifinalMatches.length !== 2) throw new Error("Expected two semifinal matches.");
  for (const match of semifinalMatches) {
    const bundle = await tallyContest(supabase, match.contest_id);
    if (bundle.contest.status !== "voting" || bundle.votes.length === 0) {
      throw new Error(`${bundle.contest.title} is not an in-progress voted semifinal.`);
    }
  }
  const tieMatch = tieMatches.find((match) => match.slot === tieSlot);
  if (!tieMatch) throw new Error("Configured tie match was not found.");
  const tied = await tallyContest(supabase, tieMatch.contest_id);
  if (tied.results.length !== 2 || tied.results[0].score !== tied.results[1].score) {
    throw new Error("Configured knockout match is not tied.");
  }
  if (!tieMatch.winner_entry_id || !tieMatch.loser_entry_id) {
    throw new Error("The tied knockout match was not resolved before semifinal generation.");
  }
  const { data: tieEntries, error: tieEntriesError } = await supabase
    .from("tournament_entries")
    .select("id,preliminary_group,preliminary_rank,screening_rank")
    .in("id", [tieMatch.left_entry_id, tieMatch.right_entry_id]);
  if (tieEntriesError) throw tieEntriesError;
  const [leftTieEntry, rightTieEntry] = [tieMatch.left_entry_id, tieMatch.right_entry_id].map(
    (entryId) => tieEntries.find((entry) => entry.id === entryId),
  );
  if (!leftTieEntry || !rightTieEntry) throw new Error("Tie entries are incomplete.");
  const usePreliminaryRank =
    leftTieEntry.preliminary_group &&
    leftTieEntry.preliminary_group === rightTieEntry.preliminary_group &&
    leftTieEntry.preliminary_rank !== rightTieEntry.preliminary_rank;
  const leftRank = usePreliminaryRank
    ? leftTieEntry.preliminary_rank
    : leftTieEntry.screening_rank;
  const rightRank = usePreliminaryRank
    ? rightTieEntry.preliminary_rank
    : rightTieEntry.screening_rank;
  const expectedTieWinnerId = leftRank < rightRank ? leftTieEntry.id : rightTieEntry.id;
  if (expectedTieWinnerId !== tieMatch.winner_entry_id) {
    throw new Error("Stored tie winner does not match the production tiebreak order.");
  }
  const contestIds = allMatches.map((match) => match.contest_id).filter(Boolean);
  const { count: loveVoteCount, error: loveError } = await supabase
    .from("love_vote_allocations")
    .select("id", { count: "exact", head: true })
    .in("contest_id", contestIds);
  if (loveError) throw loveError;
  if (!loveVoteCount) throw new Error("No knockout love-vote allocations were created.");
  return { matchCount: allMatches.length, semifinalCount: 2, loveVoteCount, tiedScore: tied.results[0].score };
}

function roundTitle(round, slot) {
  if (round === "quarterfinal") return `8 强第 ${slot} 场`;
  if (round === "semifinal") return `半决赛第 ${slot} 场`;
  if (round === "final") return "冠军赛";
  if (round === "third_place") return "季军赛";
  return `${round} #${slot}`;
}

async function generateFollowupRound(
  supabase,
  tournament,
  sourceRound,
  targetGroupId = null,
) {
  const plan = nextRoundPlan(sourceRound);
  const existing = await getRoundMatches(supabase, tournament.id, plan.targetRound);
  if (existing.length > 0) return;
  const sourceResolutions = await resolveRound(supabase, tournament.id, sourceRound);
  const resolutionBySlot = new Map(sourceResolutions.map((result) => [result.slot, result]));
  const targetMatches = plan.targets.map((target) => {
    const left = resolutionBySlot.get(target.sourceSlots[0]);
    const right = resolutionBySlot.get(target.sourceSlots[1]);
    if (!left || !right) throw new Error(`Missing source results for ${target.round} #${target.slot}.`);
    return {
      ...target,
      title: roundTitle(target.round, target.slot),
      leftEntryId:
        target.participant === "loser" ? left.loserEntryId : left.winnerEntryId,
      rightEntryId:
        target.participant === "loser" ? right.loserEntryId : right.winnerEntryId,
      sourceRound,
    };
  });
  const seed = `simulation:${tournament.id}:${plan.targetRound}`;
  const input = { tournamentId: tournament.id, sourceRound, sourceMatches: sourceResolutions };
  const output = { matches: targetMatches };
  const { error } = await supabase.rpc("create_knockout_followup_matches_atomic", {
    p_tournament_id: tournament.id,
    p_target_group_id: targetGroupId,
    p_seed: seed,
    p_input: input,
    p_output: output,
    p_source_results: sourceResolutions,
    p_matches: targetMatches,
    p_created_by: tournament.created_by,
  });
  if (error) throw error;
  if (targetGroupId) {
    const createdMatches = (
      await Promise.all(
        [...new Set(targetMatches.map((match) => match.round))].map((round) =>
          getRoundMatches(supabase, tournament.id, round),
        ),
      )
    ).flat();
    const { error: loveError } = await supabase
      .from("contests")
      .update({ love_vote_enabled: true })
      .in("id", createdMatches.map((match) => match.contest_id));
    if (loveError) throw loveError;
  }
  console.log(`Generated ${targetMatches.length} ${plan.targetRound} contest(s) through create_knockout_followup_matches_atomic.`);
}

async function finalizeTournament(supabase, tournament) {
  const [{ data: current, error: tournamentError }, finalMatches, thirdPlaceMatches] =
    await Promise.all([
      supabase.from("tournaments").select("status").eq("id", tournament.id).single(),
      getRoundMatches(supabase, tournament.id, "final"),
      getRoundMatches(supabase, tournament.id, "third_place"),
    ]);
  if (tournamentError) throw tournamentError;
  if (current.status === "completed") return;
  if (finalMatches.length !== 1 || thirdPlaceMatches.length !== 1) {
    throw new Error("Final and third-place matches must both exist before finalization.");
  }

  const [finalResolution] = await resolveRound(supabase, tournament.id, "final");
  const [thirdResolution] = await resolveRound(supabase, tournament.id, "third_place");
  for (const resolution of [finalResolution, thirdResolution]) {
    const { error } = await supabase
      .from("tournament_matches")
      .update({
        winner_entry_id: resolution.winnerEntryId,
        loser_entry_id: resolution.loserEntryId,
      })
      .eq("id", resolution.matchId)
      .eq("tournament_id", tournament.id);
    if (error) throw error;
  }

  const { error: championError } = await supabase
    .from("tournament_entries")
    .update({ status: "champion" })
    .eq("tournament_id", tournament.id)
    .eq("id", finalResolution.winnerEntryId);
  if (championError) throw championError;
  const { error: eliminatedError } = await supabase
    .from("tournament_entries")
    .update({ status: "eliminated" })
    .eq("tournament_id", tournament.id)
    .neq("id", finalResolution.winnerEntryId)
    .neq("status", "withdrawn");
  if (eliminatedError) throw eliminatedError;
  const { error: completeError } = await supabase
    .from("tournaments")
    .update({ status: "completed" })
    .eq("id", tournament.id);
  if (completeError) throw completeError;

  const seed = `simulation:${tournament.id}:finalization`;
  const { error: logError } = await supabase.from("tournament_draw_logs").insert({
    tournament_id: tournament.id,
    stage_id: finalMatches[0].stage_id,
    kind: "knockout_finalization",
    seed,
    input: {
      tournamentId: tournament.id,
      rounds: ["final", "third_place"],
      matches: [finalMatches[0], thirdPlaceMatches[0]].map((match) => ({
        matchId: match.id,
        round: match.round,
        slot: match.slot,
        contestId: match.contest_id,
      })),
    },
    output: {
      finalizedMatches: [finalResolution, thirdResolution],
      championEntryId: finalResolution.winnerEntryId,
    },
    created_by: tournament.created_by,
  });
  if (logError) throw logError;
  console.log("Finalized final and third-place results; tournament is completed.");
}

async function verifyTournament(supabase, tournamentId, voterCount) {
  const [
    { data: tournament, error: tournamentError },
    { data: matches, error: matchError },
    { data: entries, error: entryError },
    { data: stages, error: stageError },
  ] = await Promise.all([
    supabase.from("tournaments").select("id,name,status").eq("id", tournamentId).single(),
    supabase.from("tournament_matches").select("*").eq("tournament_id", tournamentId),
    supabase.from("tournament_entries").select("*").eq("tournament_id", tournamentId),
    supabase
      .from("tournament_stages")
      .select("id,kind,contest_id")
      .eq("tournament_id", tournamentId)
      .in("kind", ["preliminary", "knockout"]),
  ]);
  if (tournamentError) throw tournamentError;
  if (matchError) throw matchError;
  if (entryError) throw entryError;
  if (stageError) throw stageError;
  if (tournament.status !== "completed") throw new Error("Tournament is not completed.");
  if (matches.length !== 16 || matches.some((match) => !match.winner_entry_id || !match.loser_entry_id)) {
    throw new Error("Expected 16 fully resolved knockout matches.");
  }
  const champions = entries.filter((entry) => entry.status === "champion");
  if (champions.length !== 1) throw new Error("Expected exactly one champion entry.");
  const champion = champions[0];
  const finalMatch = matches.find((match) => match.round === "final");
  if (finalMatch?.winner_entry_id !== champion.id) {
    throw new Error("Champion entry does not match the final winner.");
  }

  const stageContestIds = stages.map((stage) => stage.contest_id).filter(Boolean);
  if (stageContestIds.length !== 20 || new Set(stageContestIds).size !== 20) {
    throw new Error("Expected 4 preliminary and 16 knockout stage contests.");
  }
  const { data: contests, error: contestError } = await supabase
    .from("contests")
    .select("id,status")
    .in("id", stageContestIds);
  if (contestError) throw contestError;
  if (contests.length !== 20 || contests.some((contest) => contest.status !== "closed")) {
    throw new Error("Every preliminary and knockout contest must be closed.");
  }
  const voteCounts = await Promise.all(
    stageContestIds.map(async (contestId) => {
      const { count, error } = await supabase
        .from("votes")
        .select("id", { count: "exact", head: true })
        .eq("contest_id", contestId);
      if (error) throw error;
      return count ?? 0;
    }),
  );
  if (voteCounts.some((count) => count !== voterCount)) {
    throw new Error(`Every simulated stage contest must contain exactly ${voterCount} votes.`);
  }
  const { data: candidate, error: candidateError } = await supabase
    .from("candidates")
    .select("id,name")
    .eq("id", champion.current_candidate_id)
    .single();
  if (candidateError) throw candidateError;

  const roundCounts = Object.fromEntries(
    ROUND_ORDER.map((round) => [round, matches.filter((match) => match.round === round).length]),
  );
  return {
    tournament,
    champion,
    candidate,
    roundCounts,
    voterCount,
    contestCount: stageContestIds.length,
    voteCount: voteCounts.reduce((sum, count) => sum + count, 0),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const fileEnv = parseEnvFile(options.envFile);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? fileEnv.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? fileEnv.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing local Supabase URL or service-role key.");
  assertLoopbackSupabaseUrl(supabaseUrl);
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: tournament, error: tournamentError } = await supabase
    .from("tournaments")
    .select("id,name,status,created_by")
    .eq("id", options.tournamentId)
    .single();
  if (tournamentError) throw tournamentError;
  if (!["active", "completed"].includes(tournament.status)) {
    throw new Error(`Tournament has unsupported status ${tournament.status}.`);
  }

  if (tournament.status === "completed") {
    const summary = await verifyTournament(supabase, tournament.id, options.voters);
    console.table(summary.roundCounts);
    console.log(`Already completed. Champion: ${summary.candidate.name}.`);
    return;
  }

  const users = await ensureMockUsers(supabase, tournament.id, options.voters);
  console.log(`Using ${users.length} tournament mock voters for ${tournament.name}.`);
  const preliminary = await simulatePreliminaries(supabase, users, tournament.id);
  const targetGroupId = preliminary[0]?.stage.group_id ?? null;
  await generateRoundOf16(supabase, tournament, preliminary, targetGroupId);
  await simulateKnockoutRound(supabase, users, tournament.id, "round_of_16", {
    tieSlot: options.tieRound === "round_of_16" ? options.tieSlot : null,
    withLoveVotes: options.withLoveVotes,
  });
  await generateFollowupRound(supabase, tournament, "round_of_16", targetGroupId);
  if (options.stopAtSemifinalVoting) {
    await publishPreliminaries(supabase, tournament.id);
    await publishRound(supabase, tournament.id, "round_of_16");
  }
  await simulateKnockoutRound(supabase, users, tournament.id, "quarterfinal", {
    tieSlot: options.tieRound === "quarterfinal" ? options.tieSlot : null,
    withLoveVotes: options.withLoveVotes,
  });
  await generateFollowupRound(supabase, tournament, "quarterfinal", targetGroupId);
  if (options.stopAtSemifinalVoting) {
    await publishRound(supabase, tournament.id, "quarterfinal");
    await simulateKnockoutRound(supabase, users, tournament.id, "semifinal", {
      tieSlot: options.tieRound === "semifinal" ? options.tieSlot : null,
      withLoveVotes: options.withLoveVotes,
      close: false,
    });
    const summary = await verifySemifinalVotingCase(
      supabase,
      tournament.id,
      options.tieRound,
      options.tieSlot,
    );
    console.table(summary);
    console.log("Stopped with both semifinals in voting status; final and third-place contests were not generated.");
    return;
  }
  await simulateKnockoutRound(supabase, users, tournament.id, "semifinal", {
    tieSlot: options.tieRound === "semifinal" ? options.tieSlot : null,
    withLoveVotes: options.withLoveVotes,
  });
  await generateFollowupRound(supabase, tournament, "semifinal", targetGroupId);
  await simulateKnockoutRound(supabase, users, tournament.id, "final");
  await simulateKnockoutRound(supabase, users, tournament.id, "third_place");
  await finalizeTournament(supabase, tournament);

  const summary = await verifyTournament(supabase, tournament.id, users.length);
  console.table(summary.roundCounts);
  console.log(`Champion: ${summary.candidate.name} (${summary.champion.id}).`);
}

const isDirectRun = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
