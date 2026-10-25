import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!url || !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) throw new Error("Local Supabase only");
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const user = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
const contests = [randomUUID(), randomUUID()];
const fields = ["name", "description", "nominator_display_name", "image_path", "image_width", "image_height", "image_size"];
const constraint = `nom_sync_${randomUUID().replaceAll("-", "")}`;
const sql = (query) => execFileSync("docker", ["exec", "-i", "supabase_db_butter-vote-local", "psql", "-U", "postgres", "-d", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1"], { input: query, encoding: "utf8" });
const data = async (query) => { const result = await query; if (result.error) throw new Error(result.error.message); return result.data; };
const nomination = (id) => data(db.from("nominations").select("*").eq("id", id).single());
const candidate = (id) => data(db.from("candidates").select("*").eq("id", id).single());
const metadata = (row) => Object.fromEntries(Object.entries(row).filter(([key]) => ![...fields, "updated_at"].includes(key)));

try {
  const owner = await data(db.from("profiles").select("id").eq("email", "user@buttervote.local").single());
  await data(db.from("contests").insert(contests.map((id) => ({ id, title: "Nomination sync verification", status: "nominating", vote_type: "single", max_choices: 1 }))));
  const rows = [];
  for (const status of ["draft", "pending", "approved", "rejected"]) {
    const id = randomUUID(), candidateId = randomUUID();
    await data(db.from("nominations").insert({ id, contest_id: contests[0], submitter_id: owner.id, name: "Original", description: "Original description", status }));
    await data(db.from("candidates").insert({ id: candidateId, contest_id: contests[0], nomination_id: id, name: "Original", description: "Original description", is_active: status !== "rejected" }));
    const before = await nomination(id);
    const update = { name: `Admin ${status}`, description: "Updated description", nominator_display_name: "Updated display name", image_path: `candidates/${candidateId}/image.jpg`, image_width: 640, image_height: 480, image_size: 1234 };
    await data(db.from("candidates").update(update).eq("id", candidateId));
    const after = await nomination(id);
    for (const field of fields) assert.equal(after[field], update[field], `${status}: ${field}`);
    assert.deepEqual(metadata(after), metadata(before), "review state and original submission metadata stay unchanged");
    assert.equal((await candidate(candidateId)).is_active, status !== "rejected");
    await data(db.from("candidates").update(update).eq("id", candidateId));
    assert.notEqual((await nomination(id)).updated_at, after.updated_at,
      "a same-path replacement with unchanged metadata still renews the image version");
    rows.push({ id, candidateId });
  }

  const root = rows[0];
  await data(db.from("candidates").update({ description: null, nominator_display_name: null, image_path: null, image_width: null, image_height: null, image_size: null }).eq("id", root.candidateId));
  const cleared = await nomination(root.id);
  for (const field of fields.filter((field) => field !== "name")) assert.equal(cleared[field], null);

  // Inherited copies update their own nomination, never the source round.
  const childId = randomUUID(), childCandidateId = randomUUID();
  await data(db.from("nominations").insert({ id: childId, contest_id: contests[1], submitter_id: owner.id, name: "Child", status: "approved" }));
  await data(db.from("candidates").insert({ id: childCandidateId, contest_id: contests[1], nomination_id: childId, inherited_from_candidate_id: root.candidateId, name: "Child" }));
  await data(db.from("candidates").update({ name: "Child edit" }).eq("id", childCandidateId));
  assert.equal((await nomination(childId)).name, "Child edit");
  assert.equal((await nomination(root.id)).name, cleared.name);
  const unlinked = randomUUID(), wrongContest = randomUUID(), unmatchedNomination = randomUUID();
  await data(db.from("nominations").insert({ id: unmatchedNomination, contest_id: contests[0], submitter_id: owner.id, name: "Unmatched origin", status: "approved" }));
  await data(db.from("candidates").insert([
    { id: unlinked, contest_id: contests[0], name: "Standalone" },
    { id: wrongContest, contest_id: contests[1], nomination_id: unmatchedNomination, name: "Cross contest" },
  ]));
  await data(db.from("candidates").update({ name: "Must not alter another nomination" }).in("id", [unlinked, wrongContest]));
  assert.equal((await nomination(root.id)).name, cleared.name);
  assert.equal((await nomination(unmatchedNomination)).name, "Unmatched origin");

  // A rejected nomination write must roll back the candidate edit as well.
  sql(`alter table public.nominations add constraint ${constraint} check (id <> '${root.id}'::uuid or name <> 'Blocked edit') not valid;`);
  const blocked = await db.from("candidates").update({ name: "Blocked edit" }).eq("id", root.candidateId);
  assert.ok(blocked.error);
  assert.equal((await candidate(root.candidateId)).name, cleared.name);
  assert.equal((await nomination(root.id)).name, cleared.name);
  sql(`alter table public.nominations drop constraint ${constraint};`);

  await data(user.auth.signInWithPassword({ email: "user@buttervote.local", password: "ButterVoteUser123!" }));
  await user.from("candidates").update({ name: "Unauthorized edit" }).eq("id", root.candidateId);
  assert.equal((await candidate(root.candidateId)).name, cleared.name);
  assert.equal((await nomination(root.id)).name, cleared.name);
  assert.match(sql("select has_function_privilege('anon','buttervote_private.sync_candidate_nomination_content()','execute') or has_function_privilege('authenticated','buttervote_private.sync_candidate_nomination_content()','execute');"), /^f\s*$/);
  console.log("Nomination sync passed: four statuses, all content fields, nulls, provenance, inheritance, unmatched links, atomic rollback and authorization.");
} finally {
  sql(`alter table public.nominations drop constraint if exists ${constraint};`);
  await data(db.from("candidates").delete().in("contest_id", contests));
  await data(db.from("contests").delete().in("id", contests));
  await user.auth.signOut({ scope: "local" });
  await Promise.allSettled([db.removeAllChannels(), user.removeAllChannels()]);
}
