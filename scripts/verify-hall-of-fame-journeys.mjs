// Local-only integration coverage for the database, admin API and rendered page.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { assertLoopbackUrl } from "./local-supabase.mjs";

const api = assertLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
const base = assertLoopbackUrl(process.env.HALL_JOURNEY_TEST_BASE_URL ?? "http://localhost:3000");
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const db = createClient(api.href, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const anon = createClient(api.href, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
const runId = randomUUID();
const title = `Journey verification ${runId}`;
const pageId = randomUUID();
const groupId = randomUUID();
const sessions = [];
const slug = `journey-${runId}`;
const hiddenTitle = `Private journey ${runId}`;
const hiddenSlug = `private-journey-${runId}`;
const webp = new Blob([Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64")], { type: "image/webp" });
async function data(query) {
  const result = await query;
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
async function session(email) {
  const profile = await data(db.from("profiles").select("id").eq("email", email).single());
  const token = randomUUID();
  const id = randomUUID();
  await data(db.from("app_sessions").insert({
    id, profile_id: profile.id,
    session_token_hash: createHash("sha256").update(token).digest("hex"),
    expires_at: new Date(Date.now() + 600_000).toISOString(),
  }));
  sessions.push(id);
  return `${process.env.APP_SESSION_COOKIE_NAME || "app_session"}=${token}`;
}
async function save(cookie, fields, upload = false) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ eventTitle: title, winnerName: title, description: "", ...fields })) {
    form.set(key, value);
  }
  if (upload) {
    form.set("poster", webp, "poster.webp");
    form.set("thumbnail", webp, "thumbnail.webp");
  }
  return fetch(new URL("/api/admin/hall-of-fame", base), {
    method: "POST", headers: cookie ? { Cookie: cookie } : {}, body: form,
  });
}
async function hall(cookie) {
  const response = await fetch(new URL("/hall-of-fame", base), {
    headers: cookie ? { Cookie: cookie } : {},
  });
  assert.equal(response.status, 200);
  return response.text();
}
async function ok(response) {
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
}
try {
  const adminCookie = await session("admin@buttervote.local");
  const userCookie = await session("user@buttervote.local");
  await data(db.from("contest_groups").insert({ id: groupId, name: title }));
  await data(db.from("site_pages").insert({ id: pageId, title, slug, visibility: "public", content_markdown: "## Journey" }));

  assert.equal((await save(null, { pageId })).status, 403);
  assert.equal((await save(userCookie, { pageId })).status, 403);
  assert.equal((await save(adminCookie, { pageId, contestGroupId: groupId })).status, 400);
  assert.equal((await save(adminCookie, { pageId: randomUUID() })).status, 400);
  assert.equal((await save(adminCookie, { pageId: "/pages/invalid" })).status, 400);

  await ok(await save(adminCookie, { contestGroupId: groupId }, true));
  const entry = await data(db.from("hall_of_fame_entries").select("*").eq("event_title", title).single());
  assert.equal(entry.contest_group_id, groupId);
  assert.equal(entry.page_id, null);
  assert.ok((await hall()).includes(`href="/groups/${groupId}"`));

  // Mutual exclusion must also hold for direct database writes.
  const rejected = await db.from("hall_of_fame_entries").update({ page_id: pageId }).eq("id", entry.id);
  assert.equal(rejected.error?.code, "23514");

  await ok(await save(adminCookie, { entryId: entry.id, pageId }));
  const linked = await data(db.from("hall_of_fame_entries").select("page_id,contest_group_id").eq("id", entry.id).single());
  assert.deepEqual(linked, { page_id: pageId, contest_group_id: null });
  assert.ok((await hall()).includes(`href="/pages/${slug}"`));

  // A page can be shared by several champions.
  await ok(await save(adminCookie, { pageId }, true));
  assert.equal((await data(db.from("hall_of_fame_entries").select("id").eq("page_id", pageId))).length, 2);

  const renamedSlug = `renamed-${slug}`;
  await data(db.from("site_pages").update({ title: `${title} renamed`, slug: renamedSlug }).eq("id", pageId));
  const renamed = await hall();
  assert.ok(renamed.includes(`href="/pages/${renamedSlug}"`));
  assert.ok(!renamed.includes(`href="/pages/${slug}"`));
  const destination = await fetch(new URL(`/pages/${renamedSlug}`, base));
  assert.equal(destination.status, 200);

  await data(db.from("site_pages").update({ title: hiddenTitle, slug: hiddenSlug, visibility: "admin_only" }).eq("id", pageId));
  for (const cookie of [null, userCookie, adminCookie]) {
    const hidden = await hall(cookie);
    assert.ok(!hidden.includes(hiddenSlug), "a private slug reached the gallery HTML or RSC payload");
    assert.ok(!hidden.includes(hiddenTitle), "a private page title reached the gallery HTML or RSC payload");
  }
  assert.equal((await data(db.from("hall_of_fame_entries").select("page_id").eq("id", entry.id).single())).page_id, pageId);
  assert.deepEqual(await data(anon.from("site_pages").select("id").eq("id", pageId)), []);
  const privateDestination = await fetch(new URL(`/pages/${hiddenSlug}`, base));
  const privateHtml = await privateDestination.text();
  // Next can start streaming before notFound(), leaving HTTP 200 with a 404
  // fallback in the stream. In either case, the private content must be absent.
  assert.ok(privateDestination.status === 404 || privateHtml.includes('name="next-error" content="not-found"'));
  assert.ok(!privateHtml.includes(hiddenTitle));
  const adminPage = await fetch(new URL("/admin/hall-of-fame", base), { headers: { Cookie: adminCookie } });
  assert.equal(adminPage.status, 200);
  const adminHtml = await adminPage.text();
  assert.ok(adminHtml.includes(hiddenTitle));
  assert.ok(adminHtml.includes("前台隐藏"));
  // An unrelated edit must preserve an existing private-page association.
  await ok(await save(adminCookie, { entryId: entry.id, pageId, description: "Updated description" }));

  await data(db.from("site_pages").update({ visibility: "public" }).eq("id", pageId));
  assert.ok((await hall()).includes(`href="/pages/${hiddenSlug}"`));
  await ok(await save(adminCookie, { entryId: entry.id }));
  assert.deepEqual(await data(db.from("hall_of_fame_entries").select("page_id,contest_group_id").eq("id", entry.id).single()), {
    page_id: null, contest_group_id: null,
  });
  await ok(await save(adminCookie, { entryId: entry.id, pageId }));
  await data(db.from("site_pages").delete().eq("id", pageId));
  const retained = await data(db.from("hall_of_fame_entries").select("id,page_id").eq("event_title", title));
  assert.equal(retained.length, 2);
  assert.ok(retained.every(row => row.page_id === null));
  assert.ok(!(await hall()).includes(`href="/pages/${hiddenSlug}"`));
  console.log("Journey verification passed: admin authorization, exclusive targets, group compatibility, shared pages, ID-based renames, private-page hiding for all viewers, republishing, clearing and deletion.");
} finally {
  // Remove only this run's fixtures and uploaded poster objects.
  const entries = await data(db.from("hall_of_fame_entries").select("poster_path,thumbnail_path").eq("event_title", title));
  if (entries.length) {
    await data(db.storage.from("hall-of-fame-posters").remove(entries.flatMap(row => [row.poster_path, row.thumbnail_path])));
  }
  await data(db.from("hall_of_fame_entries").delete().eq("event_title", title));
  await data(db.from("site_pages").delete().eq("id", pageId));
  await data(db.from("contest_groups").delete().eq("id", groupId));
  if (sessions.length) await data(db.from("app_sessions").delete().in("id", sessions));
}
