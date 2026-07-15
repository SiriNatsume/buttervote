import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  throw new Error("请先运行 npm run supabase:local:reset。 ");
}

const parsedUrl = new URL(url);
if (parsedUrl.hostname !== "127.0.0.1" && parsedUrl.hostname !== "localhost") {
  throw new Error("结果可见性集成测试只能连接本地 Supabase。");
}

const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, serviceKey, options);
const anonymous = createClient(url, anonKey, options);
const sourceContestId = randomUUID();
const downstreamContestId = randomUUID();
const terminalContestId = randomUUID();
const sourceCandidateId = randomUUID();
const inheritedCandidateId = randomUUID();
const downstreamOriginalCandidateId = randomUUID();
const deepInheritedCandidateId = randomUUID();
const deepInheritedNominationId = randomUUID();
const sessionId = randomUUID();
const downstreamSessionId = randomUUID();

async function requireData(label, query) {
  const { data, error } = await query;
  if (error) {
    throw new Error(`${label}: ${error.message}`);
  }
  return data;
}

async function publicVisibility(contestId = sourceContestId) {
  const rows = await requireData(
    "读取结果可见性",
    anonymous.rpc("get_contest_result_visibility", {
      p_contest_ids: [contestId],
      p_include_admin_override: false,
    }),
  );
  assert.equal(rows.length, 1);
  return rows[0];
}

async function visibleVoteCount() {
  const rows = await requireData(
    "读取公开票数",
    anonymous.rpc("get_visible_contest_vote_payloads", {
      p_contest_ids: [sourceContestId],
      p_include_admin_override: false,
    }),
  );
  return rows.length;
}

async function publicCandidateCount(candidateId) {
  const rows = await requireData(
    "读取继承候选",
    anonymous
      .from("candidates")
      .select("id")
      .eq("id", candidateId),
  );
  return rows.length;
}

async function visibleNominationCount(contestId, nominationId) {
  const rows = await requireData(
    "读取公开提名",
    anonymous.rpc("get_visible_contest_nominations", {
      p_contest_id: contestId,
    }),
  );
  return rows.filter((nomination) => nomination.id === nominationId).length;
}

try {
  await requireData(
    "创建测试活动",
    service.from("contests").insert([
      {
        id: sourceContestId,
        title: "Result visibility source",
        status: "closed",
        vote_type: "single",
        closed_result_visibility: "public",
        show_existing_nominations: false,
      },
      {
        id: downstreamContestId,
        title: "Result visibility downstream",
        status: "published",
        vote_type: "single",
        closed_result_visibility: "admin_only",
        show_existing_nominations: false,
      },
      {
        id: terminalContestId,
        title: "Result visibility terminal",
        status: "waiting",
        vote_type: "single",
        closed_result_visibility: "admin_only",
        show_existing_nominations: true,
      },
    ]),
  );
  await requireData(
    "创建来源候选",
    service.from("candidates").insert({
      id: sourceCandidateId,
      contest_id: sourceContestId,
      name: "Source candidate",
      is_active: true,
    }),
  );
  await requireData(
    "创建测试投票",
    service.from("votes").insert({
      contest_id: sourceContestId,
      voter_id: null,
      payload: { candidateId: sourceCandidateId },
    }),
  );
  await requireData(
    "创建继承候选",
    service.from("candidates").insert({
      id: inheritedCandidateId,
      contest_id: downstreamContestId,
      name: "Inherited candidate",
      inherited_from_candidate_id: sourceCandidateId,
      is_active: true,
    }),
  );
  await requireData(
    "创建下游原生候选",
    service.from("candidates").insert({
      id: downstreamOriginalCandidateId,
      contest_id: downstreamContestId,
      name: "Downstream original candidate",
      is_active: true,
    }),
  );
  await requireData(
    "创建多轮继承提名",
    service.from("nominations").insert({
      id: deepInheritedNominationId,
      contest_id: terminalContestId,
      name: "Deep inherited nomination",
      status: "approved",
    }),
  );
  await requireData(
    "创建多轮继承候选",
    service.from("candidates").insert({
      id: deepInheritedCandidateId,
      contest_id: terminalContestId,
      nomination_id: deepInheritedNominationId,
      name: "Deep inherited candidate",
      inherited_from_candidate_id: downstreamOriginalCandidateId,
      is_active: true,
    }),
  );

  assert.equal((await publicVisibility()).visibility_state, "full");
  assert.equal(await visibleVoteCount(), 1);
  assert.equal(await publicCandidateCount(inheritedCandidateId), 1);
  assert.equal(await publicCandidateCount(deepInheritedCandidateId), 1);
  assert.equal(
    await visibleNominationCount(terminalContestId, deepInheritedNominationId),
    1,
  );

  await requireData(
    "创建唱票会话",
    service.from("contest_calling_sessions").insert({
      id: sessionId,
      contest_id: sourceContestId,
      status: "active",
      current_step: 1,
      total_steps: 2,
      seed: "result-visibility-contract",
    }),
  );
  await requireData(
    "创建唱票事件",
    service.from("contest_calling_events").insert([
      {
        session_id: sessionId,
        contest_id: sourceContestId,
        sequence: 1,
        phase: "base",
        candidate_id: sourceCandidateId,
        delta_score: 1,
        scores: { [sourceCandidateId]: 1 },
      },
      {
        session_id: sessionId,
        contest_id: sourceContestId,
        sequence: 2,
        phase: "base",
        candidate_id: sourceCandidateId,
        delta_score: 1,
        scores: { [sourceCandidateId]: 2 },
      },
    ]),
  );

  const callingVisibility = await publicVisibility();
  assert.equal(callingVisibility.visibility_state, "calling_progress");
  assert.equal(callingVisibility.full_results_visible, false);
  const downstreamVisibility = await publicVisibility(downstreamContestId);
  assert.equal(downstreamVisibility.visibility_state, "hidden");
  assert.equal(downstreamVisibility.reason, "dependency_hidden");
  assert.equal(await visibleVoteCount(), 0);
  assert.equal(await publicCandidateCount(inheritedCandidateId), 0);
  assert.equal(
    await publicCandidateCount(deepInheritedCandidateId),
    0,
    "多轮继承必须沿整条祖先链隐藏",
  );
  assert.equal(
    await visibleNominationCount(terminalContestId, deepInheritedNominationId),
    0,
    "自动复制的提名也必须遵循候选继承可见性",
  );
  await requireData(
    "创建依赖隐藏的下游唱票会话",
    service.from("contest_calling_sessions").insert({
      id: downstreamSessionId,
      contest_id: downstreamContestId,
      status: "active",
      current_step: 1,
      total_steps: 1,
      seed: "hidden-downstream-calling",
    }),
  );
  await requireData(
    "创建依赖隐藏的下游唱票事件",
    service.from("contest_calling_events").insert({
      session_id: downstreamSessionId,
      contest_id: downstreamContestId,
      sequence: 1,
      phase: "base",
      candidate_id: downstreamOriginalCandidateId,
      delta_score: 1,
      candidate_snapshot: { name: "Must remain hidden" },
      scores: { [downstreamOriginalCandidateId]: 1 },
    }),
  );
  const hiddenDownstreamSessions = await requireData(
    "确认下游唱票会话不可见",
    anonymous
      .from("contest_calling_sessions")
      .select("id")
      .eq("id", downstreamSessionId),
  );
  assert.equal(hiddenDownstreamSessions.length, 0);
  const hiddenDownstreamEvents = await requireData(
    "确认下游唱票快照不可见",
    anonymous
      .from("contest_calling_events")
      .select("candidate_snapshot")
      .eq("session_id", downstreamSessionId),
  );
  assert.equal(hiddenDownstreamEvents.length, 0);
  const callingEvents = await requireData(
    "读取唱票进度",
    anonymous
      .from("contest_calling_events")
      .select("sequence")
      .eq("session_id", sessionId)
      .order("sequence"),
  );
  assert.deepEqual(callingEvents.map((event) => event.sequence), [1]);

  for (const table of [
    "tournament_entries",
    "tournament_matches",
    "tournament_draw_logs",
  ]) {
    const { error } = await anonymous.from(table).select("id").limit(1);
    assert.ok(error, `匿名用户不应能读取 ${table}`);
  }

  await requireData(
    "归档下游唱票测试会话",
    service
      .from("contest_calling_sessions")
      .update({
        status: "archived",
        archived_at: new Date().toISOString(),
      })
      .eq("id", downstreamSessionId),
  );

  await requireData(
    "完成唱票并发布",
    service.rpc("complete_contest_calling_session", {
      p_session_id: sessionId,
    }),
  );
  const publishedContest = await requireData(
    "确认活动发布状态",
    service.from("contests").select("status").eq("id", sourceContestId).single(),
  );
  assert.equal(publishedContest.status, "published");
  assert.equal((await publicVisibility()).visibility_state, "full");
  assert.equal(await visibleVoteCount(), 1);
  assert.equal(await publicCandidateCount(inheritedCandidateId), 1);
  assert.equal(await publicCandidateCount(deepInheritedCandidateId), 1);
  assert.equal(
    await visibleNominationCount(terminalContestId, deepInheritedNominationId),
    1,
  );

  await requireData(
    "模拟缺少显式发布的完成会话",
    service
      .from("contests")
      .update({ status: "closed", closed_result_visibility: "admin_only" })
      .eq("id", sourceContestId),
  );
  assert.equal((await publicVisibility()).visibility_state, "hidden");
  assert.equal(await visibleVoteCount(), 0);
  assert.equal(await publicCandidateCount(inheritedCandidateId), 0);
  assert.equal(await publicCandidateCount(deepInheritedCandidateId), 0);
  assert.equal(
    await visibleNominationCount(terminalContestId, deepInheritedNominationId),
    0,
  );
  const hiddenCompletedEvents = await requireData(
    "确认未发布完成会话不公开事件",
    anonymous
      .from("contest_calling_events")
      .select("sequence")
      .eq("session_id", sessionId),
  );
  assert.equal(hiddenCompletedEvents.length, 0);

  const serviceAdminVisibility = await requireData(
    "确认 service_role 管理员裁决",
    service.rpc("get_contest_result_visibility", {
      p_contest_ids: [sourceContestId],
      p_include_admin_override: true,
    }),
  );
  assert.equal(serviceAdminVisibility[0]?.visibility_state, "full");
  assert.equal(serviceAdminVisibility[0]?.reason, "admin");
  const servicePublicVisibility = await requireData(
    "确认公开组件关闭管理员覆盖",
    service.rpc("get_contest_result_visibility", {
      p_contest_ids: [sourceContestId],
      p_include_admin_override: false,
    }),
  );
  assert.equal(servicePublicVisibility[0]?.visibility_state, "hidden");
  const serviceDefaultVisibility = await requireData(
    "确认 service_role 默认不会启用管理员覆盖",
    service.rpc("get_contest_result_visibility", {
      p_contest_ids: [sourceContestId],
    }),
  );
  assert.equal(serviceDefaultVisibility[0]?.visibility_state, "hidden");
  const serviceDefaultVotes = await requireData(
    "确认 service_role 默认不会读取隐藏票数",
    service.rpc("get_visible_contest_vote_payloads", {
      p_contest_ids: [sourceContestId],
    }),
  );
  assert.equal(serviceDefaultVotes.length, 0);

  await requireData(
    "重新打开唱票会话",
    service
      .from("contest_calling_sessions")
      .update({
        status: "paused",
        current_step: 1,
        play_mode: "auto",
        completed_at: null,
      })
      .eq("id", sessionId),
  );
  await requireData(
    "验证直接完成也会显式发布",
    service
      .from("contest_calling_sessions")
      .update({ status: "completed" })
      .eq("id", sessionId),
  );
  const triggerPublishedContest = await requireData(
    "确认完成状态触发发布",
    service.from("contests").select("status").eq("id", sourceContestId).single(),
  );
  assert.equal(triggerPublishedContest.status, "published");
  const triggerCompletedSession = await requireData(
    "确认完成状态规范化会话",
    service
      .from("contest_calling_sessions")
      .select("status,current_step,total_steps,play_mode,completed_at")
      .eq("id", sessionId)
      .single(),
  );
  assert.equal(triggerCompletedSession.status, "completed");
  assert.equal(
    triggerCompletedSession.current_step,
    triggerCompletedSession.total_steps,
  );
  assert.equal(triggerCompletedSession.play_mode, "manual");
  assert.ok(triggerCompletedSession.completed_at);

  console.log("result visibility local integration checks passed");
} finally {
  await service.from("contests").delete().eq("id", terminalContestId);
  await service.from("contests").delete().eq("id", downstreamContestId);
  await service.from("contests").delete().eq("id", sourceContestId);
}
