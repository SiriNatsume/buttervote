import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { assertLoopbackSupabaseUrl } from "./simulate-tournament.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = path.join(ROOT, ".local", "supabase-app.env");
const SOURCE_NAME = "bracket test tournament";
const TARGET_NAME = "bracket test tournament 2";

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

async function main() {
  const env = parseEnvFile(ENV_FILE);
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing local Supabase credentials.");
  assertLoopbackSupabaseUrl(supabaseUrl);
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: existing, error: existingError } = await supabase
    .from("tournaments")
    .select("id,name,status")
    .eq("name", TARGET_NAME)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) {
    console.log(JSON.stringify({ tournamentId: existing.id, existing: true }));
    return;
  }

  const { data: source, error: sourceError } = await supabase
    .from("tournaments")
    .select("id,name,created_by")
    .eq("name", SOURCE_NAME)
    .maybeSingle();
  if (sourceError || !source) {
    throw new Error(sourceError?.message ?? `Source tournament '${SOURCE_NAME}' was not found.`);
  }

  const [{ data: screeningStage, error: stageError }, { data: sourceEntries, error: entriesError }] =
    await Promise.all([
      supabase
        .from("tournament_stages")
        .select("id,contest_id")
        .eq("tournament_id", source.id)
        .eq("kind", "screening")
        .limit(1)
        .maybeSingle(),
      supabase
        .from("tournament_entries")
        .select("root_candidate_id,preliminary_group,screening_rank")
        .eq("tournament_id", source.id)
        .not("preliminary_group", "is", null)
        .order("screening_rank", { ascending: true }),
    ]);
  if (stageError || !screeningStage?.contest_id) {
    throw new Error(stageError?.message ?? "Source screening stage is missing.");
  }
  if (entriesError) throw entriesError;
  if (sourceEntries?.length !== 48) {
    throw new Error(`Expected 48 source entries, found ${sourceEntries?.length ?? 0}.`);
  }

  const { data: group, error: groupError } = await supabase
    .from("contest_groups")
    .insert({
      name: `${TARGET_NAME} group`,
      description: "Local bracket, tiebreak, and love-vote test data.",
      love_vote_weight: 3,
      love_vote_quota: 99,
      created_by: source.created_by,
    })
    .select("id,love_vote_weight,love_vote_quota")
    .single();
  if (groupError) throw groupError;

  const { data: created, error: createError } = await supabase.rpc(
    "create_tournament_with_screening_stage_atomic",
    {
      p_name: TARGET_NAME,
      p_screening_contest_id: screeningStage.contest_id,
      p_config: {
        format: "butter_vote_tournament_v1",
        testCase: "semifinal_voting_with_knockout_tie_and_love_votes",
      },
      p_created_by: source.created_by,
    },
  );
  if (createError) throw createError;
  const tournamentId = created?.tournamentId;
  if (typeof tournamentId !== "string") throw new Error("Tournament RPC returned no id.");

  const { data: targetScreening, error: targetStageError } = await supabase
    .from("tournament_stages")
    .select("id")
    .eq("tournament_id", tournamentId)
    .eq("kind", "screening")
    .single();
  if (targetStageError) throw targetStageError;

  const groups = ["A", "B", "C", "D"].map((preliminaryGroup) => ({
    group: preliminaryGroup,
    candidates: sourceEntries
      .filter((entry) => entry.preliminary_group === preliminaryGroup)
      .map((entry) => ({
        candidateId: entry.root_candidate_id,
        screeningRank: entry.screening_rank,
      })),
  }));
  if (groups.some((item) => item.candidates.length !== 12)) {
    throw new Error("Source preliminary groups are not 12 candidates each.");
  }

  const seed = `test:${tournamentId}:preliminary`;
  const { error: preliminaryError } = await supabase.rpc("create_preliminary_stage_atomic", {
    p_tournament_id: tournamentId,
    p_screening_stage_id: targetScreening.id,
    p_target_group_id: group.id,
    p_seed: seed,
    p_input: { sourceTournamentId: source.id, sourceScreeningContestId: screeningStage.contest_id },
    p_output: { groups },
    p_groups: groups,
    p_created_by: source.created_by,
  });
  if (preliminaryError) throw preliminaryError;

  console.log(
    JSON.stringify({
      tournamentId,
      groupId: group.id,
      loveVoteWeight: Number(group.love_vote_weight),
      loveVoteQuota: group.love_vote_quota,
      existing: false,
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
