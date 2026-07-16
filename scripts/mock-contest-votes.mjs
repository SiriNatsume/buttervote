import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_ENV_FILE = path.join(ROOT, ".local", "supabase-app.env");
const MOCK_PURPOSE = "tournament-bracket-mock";
const DEFAULT_VOTER_COUNT = 120;
const DEFAULT_SEED = "buttervote-bracket-votes-v1";
const CONCURRENCY = 8;

function parseEnvFile(filePath) {
  return Object.fromEntries(
    readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

function parseArgs(argv) {
  const options = {
    contestId: null,
    voters: DEFAULT_VOTER_COUNT,
    seed: DEFAULT_SEED,
    cleanup: false,
    envFile: DEFAULT_ENV_FILE,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--cleanup") {
      options.cleanup = true;
    } else if (argument === "--contest-id") {
      options.contestId = argv[++index] ?? null;
    } else if (argument === "--voters") {
      options.voters = Number(argv[++index]);
    } else if (argument === "--seed") {
      options.seed = argv[++index] ?? DEFAULT_SEED;
    } else if (argument === "--env-file") {
      options.envFile = path.resolve(ROOT, argv[++index] ?? "");
    } else {
      throw new Error(`未知参数：${argument}`);
    }
  }

  if (!options.contestId || !/^[0-9a-f-]{36}$/i.test(options.contestId)) {
    throw new Error("请通过 --contest-id 提供有效的 Contest UUID。");
  }
  if (!Number.isInteger(options.voters) || options.voters < 2 || options.voters > 500) {
    throw new Error("--voters 必须是 2 到 500 之间的整数。");
  }
  return options;
}

export function assertLoopbackSupabaseUrl(value) {
  const url = new URL(value);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error(`拒绝向非本地 Supabase 生成 mock 投票：${url.origin}`);
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

export function buildTargetScores(candidateCount, voterCount) {
  if (!Number.isInteger(candidateCount) || candidateCount < 1) {
    throw new Error("候选项数量必须为正整数。");
  }
  if (!Number.isInteger(voterCount) || voterCount < 2) {
    throw new Error("投票用户数量必须至少为 2。");
  }

  const maximum = Math.max(1, Math.floor(voterCount * 0.9));
  const minimum = Math.max(1, Math.floor(voterCount * 0.1));
  const scores = Array.from({ length: candidateCount }, (_, index) => {
    if (candidateCount === 1) return maximum;
    const progress = index / (candidateCount - 1);
    return Math.round(maximum - (maximum - minimum) * progress);
  });

  // Every fourth position shares the previous score, creating deterministic
  // tie groups for tournament tiebreaker testing.
  for (let index = 3; index < scores.length - 1; index += 4) {
    scores[index] = scores[index - 1];
  }
  return scores;
}

function greatestCommonDivisor(left, right) {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return a;
}

export function buildApprovalMatrix(candidateIds, targetScores, voterCount, seed) {
  if (candidateIds.length !== targetScores.length) {
    throw new Error("候选项与目标票数数量不一致。");
  }
  if (targetScores.some((score) => score < 1 || score > voterCount)) {
    throw new Error("目标票数必须位于 1 到投票用户数之间。");
  }

  const seedHash = hashSeed(seed);
  let stride = Math.max(1, Math.floor(voterCount * 0.44));
  while (greatestCommonDivisor(stride, voterCount) !== 1) stride += 1;

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const selections = Array.from({ length: voterCount }, () => []);
    candidateIds.forEach((candidateId, candidateIndex) => {
      const start =
        (seedHash + candidateIndex * 37 + attempt * 17) % voterCount;
      for (let approval = 0; approval < targetScores[candidateIndex]; approval += 1) {
        const voterIndex = (start + approval * stride) % voterCount;
        selections[voterIndex].push(candidateId);
      }
    });

    if (selections.every((candidateIdsForVoter) => candidateIdsForVoter.length > 0)) {
      return selections;
    }
  }
  throw new Error("无法构造每位用户至少选择一项的投票矩阵。");
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
  const perPage = 1000;
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < perPage) return users;
  }
}

function isContestMockUser(user, contestId) {
  return (
    user.user_metadata?.purpose === MOCK_PURPOSE &&
    user.user_metadata?.contest_id === contestId
  );
}

async function cleanupMockData(supabase, contestId) {
  const allUsers = await listAllAuthUsers(supabase);
  const mockUsers = allUsers.filter((user) => isContestMockUser(user, contestId));
  const userIds = mockUsers.map((user) => user.id);

  for (let index = 0; index < userIds.length; index += 100) {
    const chunk = userIds.slice(index, index + 100);
    const { error } = await supabase
      .from("votes")
      .delete()
      .eq("contest_id", contestId)
      .in("voter_id", chunk);
    if (error) throw error;
  }

  await mapWithConcurrency(mockUsers, CONCURRENCY, async (user) => {
    const { error } = await supabase.auth.admin.deleteUser(user.id);
    if (error) throw error;
  });

  return mockUsers.length;
}

async function loadContest(supabase, contestId) {
  const [{ data: contest, error: contestError }, { data: candidates, error: candidatesError }] =
    await Promise.all([
      supabase
        .from("contests")
        .select("id,title,status,vote_type,max_choices,require_exact_choices,archived_at")
        .eq("id", contestId)
        .single(),
      supabase
        .from("candidates")
        .select("id,name")
        .eq("contest_id", contestId)
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("name", { ascending: true }),
    ]);

  if (contestError) throw contestError;
  if (candidatesError) throw candidatesError;
  if (contest.archived_at || contest.status !== "voting") {
    throw new Error("目标 Contest 必须处于 voting 状态且未归档。");
  }
  if (contest.vote_type !== "multiple" || contest.require_exact_choices) {
    throw new Error("目标 Contest 必须使用不要求选满的 multiple 投票模式。");
  }
  if (!candidates?.length) throw new Error("目标 Contest 没有有效候选项。");
  if (contest.max_choices < candidates.length) {
    throw new Error(
      `max_choices=${contest.max_choices}，不足以允许对全部 ${candidates.length} 个候选项投赞成票。`,
    );
  }
  return { contest, candidates };
}

function mockEmailPrefix(contestId) {
  return `bracket-${contestId.slice(0, 8)}-voter-`;
}

async function createMockUsers(supabase, contestId, voterCount) {
  const prefix = mockEmailPrefix(contestId);
  return mapWithConcurrency(
    Array.from({ length: voterCount }, (_, index) => index),
    CONCURRENCY,
    async (index) => {
      const email = `${prefix}${String(index + 1).padStart(3, "0")}@buttervote.local`;
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password: "ButterVoteMock123!",
        email_confirm: true,
        user_metadata: {
          display_name: `Mock Voter ${String(index + 1).padStart(3, "0")}`,
          purpose: MOCK_PURPOSE,
          contest_id: contestId,
        },
      });
      if (error || !data.user) {
        throw new Error(`创建 ${email} 失败：${error?.message ?? "未知错误"}`);
      }
      return data.user;
    },
  );
}

function tallyVotes(votes, candidateIds) {
  const totals = new Map(candidateIds.map((candidateId) => [candidateId, 0]));
  for (const vote of votes) {
    const selected = vote.payload?.candidateIds;
    if (!Array.isArray(selected) || selected.length === 0) {
      throw new Error(`投票 ${vote.id} 的 candidateIds 无效。`);
    }
    if (new Set(selected).size !== selected.length) {
      throw new Error(`投票 ${vote.id} 包含重复候选项。`);
    }
    for (const candidateId of selected) {
      if (!totals.has(candidateId)) {
        throw new Error(`投票 ${vote.id} 包含不属于该 Contest 的候选项。`);
      }
      totals.set(candidateId, totals.get(candidateId) + 1);
    }
  }
  return totals;
}

function rankingRows(candidates, totals, expectedScores) {
  let previousScore = null;
  let previousRank = 0;
  return candidates.map((candidate, index) => {
    const votes = totals.get(candidate.id) ?? 0;
    const rank = votes === previousScore ? previousRank : index + 1;
    previousScore = votes;
    previousRank = rank;
    return {
      rank,
      candidate: candidate.name,
      votes,
      expected: expectedScores[index],
    };
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const fileEnv = parseEnvFile(options.envFile);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? fileEnv.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? fileEnv.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("缺少本地 Supabase URL 或 service role key。");
  }
  assertLoopbackSupabaseUrl(supabaseUrl);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const removedUsers = await cleanupMockData(supabase, options.contestId);
  console.log(`已清理 ${removedUsers} 个旧 mock 用户及其目标 Contest 投票。`);
  if (options.cleanup) return;

  const { contest, candidates } = await loadContest(supabase, options.contestId);
  const targetScores = buildTargetScores(candidates.length, options.voters);
  const selections = buildApprovalMatrix(
    candidates.map((candidate) => candidate.id),
    targetScores,
    options.voters,
    options.seed,
  );

  console.log(
    `正在为「${contest.title}」创建 ${options.voters} 个用户和 ${candidates.length} 项赞成票排名数据...`,
  );
  const users = await createMockUsers(supabase, options.contestId, options.voters);

  await mapWithConcurrency(users, CONCURRENCY, async (user, index) => {
    const { error } = await supabase.rpc("submit_vote_with_love", {
      p_contest_id: options.contestId,
      p_voter_id: user.id,
      p_payload: { candidateIds: selections[index] },
      p_love_candidate_ids: [],
    });
    if (error) throw new Error(`Mock Voter ${index + 1} 投票失败：${error.message}`);
  });

  const userIds = new Set(users.map((user) => user.id));
  const { data: allVotes, error: votesError } = await supabase
    .from("votes")
    .select("id,voter_id,payload")
    .eq("contest_id", options.contestId);
  if (votesError) throw votesError;
  const mockVotes = (allVotes ?? []).filter((vote) => userIds.has(vote.voter_id));
  if (mockVotes.length !== options.voters) {
    throw new Error(`预期 ${options.voters} 张 mock 投票，实际 ${mockVotes.length} 张。`);
  }

  const totals = tallyVotes(mockVotes, candidates.map((candidate) => candidate.id));
  const rows = rankingRows(candidates, totals, targetScores);
  const mismatch = rows.find((row) => row.votes !== row.expected);
  if (mismatch) {
    throw new Error(
      `${mismatch.candidate} 票数不匹配：预期 ${mismatch.expected}，实际 ${mismatch.votes}。`,
    );
  }

  console.table(rows);
  console.log(
    `完成：${users.length} 个 mock 用户，${mockVotes.length} 张投票，${candidates.length} 个候选项均已获得赞成票。`,
  );
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
