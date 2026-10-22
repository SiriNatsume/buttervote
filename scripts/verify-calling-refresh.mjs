import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

// This script creates and removes its own fixtures, exclusively on local Supabase.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey || !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) {
  throw new Error("请使用 .local/supabase-app.env，仅允许连接本地 Supabase。");
}
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, serviceKey, options);
const guest = createClient(url, anonKey, options);
const viewer = createClient(url, anonKey, options);
const contestIds = [randomUUID(), randomUUID(), randomUUID()];
const sessionIds = contestIds.map(() => randomUUID());
const candidateId = randomUUID();
const inheritedCandidateId = randomUUID();
let viewerId;
const messages = [];
const channels = [];

async function data(label, query) {
  const response = await query;
  if (response.error) throw new Error(`${label}: ${response.error.message}`);
  return response.data;
}

async function join(client, contestId, allowed = true) {
  const channel = client.channel(`buttervote:calling:${contestId}`, {
    config: { private: true, broadcast: { ack: true } },
  });
  channels.push([client, channel]);
  channel.on("broadcast", { event: "calling_changed" }, (message) => {
    assert.deepEqual(Object.keys(message.payload), ["id"], "broadcast must contain only the generated message ID");
    messages.push({ contestId, client, at: Date.now() });
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (allowed) reject(new Error("visible subscription timeout"));
      else resolve(); // rejected joins need not emit a status in every SDK transport
    }, allowed ? 5000 : 2000);
    channel.subscribe((status, error) => {
      if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "CLOSED") {
        clearTimeout(timer);
        if ((status === "SUBSCRIBED") !== allowed) reject(error || new Error(`unexpected ${status}`));
        else resolve();
      }
    });
  });
  if (!allowed) await client.removeChannel(channel);
  console.log(`${allowed ? "visible" : "hidden"} channel authorization verified`);
  return channel;
}

async function changed(label, mutate, expectedContest = contestIds[0]) {
  const before = messages.length;
  const started = Date.now();
  await mutate();
  while (!messages.slice(before).some((message) => message.contestId === expectedContest && message.client === guest)) {
    if (Date.now() - started > 3000) throw new Error(`${label}: no broadcast`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  console.log(`${label}: broadcast received in ${Date.now() - started}ms`);
}

const update = (patch, index = 0) => data("update session", service.from("contest_calling_sessions")
  .update(patch).eq("id", sessionIds[index]));

try {
  await data("create contests", service.from("contests").insert(contestIds.map((id, index) => ({
    id, title: `Calling refresh verification ${index}`, status: index === 2 ? "draft" : "closed",
    vote_type: "single", closed_result_visibility: "public",
  }))));
  await data("create candidate", service.from("candidates").insert({
    id: candidateId, contest_id: contestIds[0], name: "Refresh test", is_active: true,
  }));
  await data("create sessions", service.from("contest_calling_sessions").insert(sessionIds.map((id, index) => ({
    id, contest_id: contestIds[index], seed: "refresh-verification", status: "draft",
    total_steps: 3, metadata: { privateFutureResult: "must not appear in broadcast" },
  }))));
  await data("create future event", service.from("contest_calling_events").insert({
    session_id: sessionIds[0], contest_id: contestIds[0], sequence: 3,
    phase: "base", candidate_id: candidateId, scores: [{ score: 999 }],
  }));

  assert.equal((await data("guest initial session", guest.from("contest_calling_sessions")
    .select("id").eq("id", sessionIds[0]))).length, 1, "guest must see draft session before subscription");
  const guestChannel = await join(guest, contestIds[0]);
  await join(guest, contestIds[1]); // one viewer, multiple contests
  await join(guest, contestIds[2], false); // hidden session cannot authorize a join
  assert.equal((await data("hidden session RLS", guest.from("contest_calling_sessions")
    .select("id").eq("id", sessionIds[2]))).length, 0);
  const email = `calling-refresh-${randomUUID()}@buttervote.local`;
  const password = randomUUID();
  const created = await data("create ordinary viewer", service.auth.admin.createUser({ email, password, email_confirm: true }));
  viewerId = created.user.id;
  await data("viewer login", viewer.auth.signInWithPassword({ email, password }));
  await join(viewer, contestIds[0]);

  const spoofResult = await guestChannel.send({ type: "broadcast", event: "calling_changed", payload: {} }, { timeout: 1000 });
  assert.notEqual(spoofResult, "ok", "guest must not spoof server notifications");
  assert.equal(messages.length, 0);

  await changed("start", () => update({ status: "active", current_step: 1 }));
  assert.ok(messages.some((message) => message.client === viewer), "signed-in viewer also receives updates");
  assert.equal((await data("future event RLS", guest.from("contest_calling_events").select("id")
    .eq("session_id", sessionIds[0]))).length, 0);
  await changed("advance", () => update({ current_step: 2 }));
  await changed("rewind", () => update({ current_step: 1 }));
  await changed("pause", () => update({ status: "paused" }));
  await changed("resume and auto mode", () => update({ status: "active", play_mode: "auto" }));
  await changed("group second contest", () => update({ status: "active", current_step: 1 }, 1), contestIds[1]);
  await changed("inherited round becomes hidden", () => data("create inheritance", service.from("candidates").insert({
    id: inheritedCandidateId, contest_id: contestIds[1], name: "Inherited refresh test",
    inherited_from_candidate_id: candidateId, is_active: true,
  })), contestIds[1]);
  assert.equal((await data("downstream visibility", guest.from("contest_calling_sessions").select("id")
    .eq("id", sessionIds[1]))).length, 0);
  const beforeCompletion = messages.length;
  await changed("atomic completion", () => data("complete", service.rpc("complete_contest_calling_session", {
    p_session_id: sessionIds[0],
  })));
  assert.equal((await data("completion", guest.from("contest_calling_sessions").select("status")
    .eq("id", sessionIds[0]).single())).status, "completed");
  assert.ok(messages.slice(beforeCompletion).some((message) => message.contestId === contestIds[1]),
    "source completion must also invalidate downstream rounds");
  assert.equal((await data("downstream visible again", guest.from("contest_calling_sessions").select("id")
    .eq("id", sessionIds[1]))).length, 1);
  await changed("archive", () => update({ status: "archived", archived_at: new Date().toISOString() }));
  assert.equal((await data("archive RLS", guest.from("contest_calling_sessions").select("id")
    .eq("id", sessionIds[0]))).length, 0);
  await changed("delete", () => data("delete session", service.from("contest_calling_sessions").delete().eq("id", sessionIds[0])));
  await changed("contest visibility revoked", () => data("hide contest", service.from("contests")
    .update({ archived_at: new Date().toISOString() }).eq("id", contestIds[1])), contestIds[1]);
  assert.equal((await data("hidden contest RLS", guest.from("contest_calling_sessions").select("id")
    .eq("id", sessionIds[1]))).length, 0);
  console.log("Calling refresh integration checks passed (guest, authenticated viewer, group, RLS, lifecycle).");
} finally {
  await Promise.allSettled(channels.map(([client, channel]) => client.removeChannel(channel)));
  await viewer.auth.signOut();
  if (viewerId) await service.auth.admin.deleteUser(viewerId);
  await data("remove fixture contests", service.from("contests").delete().in("id", contestIds));
  await Promise.allSettled([service.removeAllChannels(), guest.removeAllChannels(), viewer.removeAllChannels()]);
}
