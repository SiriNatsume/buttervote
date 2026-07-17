import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) throw new Error("Local Supabase env is incomplete.");

const parsedUrl = new URL(url);
if (!["localhost", "127.0.0.1", "::1"].includes(parsedUrl.hostname)) {
  throw new Error("This verification script only runs against loopback Supabase.");
}

const service = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anon = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const normalUser = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const runId = crypto.randomUUID();
const publicPageId = crypto.randomUUID();
const hiddenPageId = crypto.randomUUID();
const publicAssetId = crypto.randomUUID();
const hiddenAssetId = crypto.randomUUID();
const contestGroupId = crypto.randomUUID();

try {
  const { error: pageInsertError } = await service.from("site_pages").insert([
    {
      id: publicPageId,
      title: "Security test public page",
      slug: `security-public-${runId}`,
      visibility: "public",
    },
    {
      id: hiddenPageId,
      title: "Security test hidden page",
      slug: `security-hidden-${runId}`,
      visibility: "admin_only",
    },
  ]);
  if (pageInsertError) throw pageInsertError;

  const { error: groupInsertError } = await service.from("contest_groups").insert({
    id: contestGroupId,
    name: "Security test group",
  });
  if (groupInsertError) throw groupInsertError;

  const { error: publicRelationError } = await service
    .from("contest_group_pages")
    .insert({ contest_group_id: contestGroupId, page_id: publicPageId });
  if (publicRelationError) throw publicRelationError;

  const { error: hiddenRelationError } = await service
    .from("contest_group_pages")
    .insert({ contest_group_id: contestGroupId, page_id: hiddenPageId });
  assert.ok(hiddenRelationError, "admin-only page was unexpectedly linked to a group");

  const { error: linkedDowngradeError } = await service
    .from("site_pages")
    .update({ visibility: "admin_only" })
    .eq("id", publicPageId);
  assert.ok(linkedDowngradeError, "linked page was unexpectedly made admin-only");

  const assetBase = {
    original_filename: "security-test.pdf",
    extension: "pdf",
    mime_type: "application/pdf",
    byte_size: 10,
    asset_type: "attachment",
  };
  const { error: assetInsertError } = await service.from("page_assets").insert([
    {
      ...assetBase,
      id: publicAssetId,
      storage_path: `security/${publicAssetId}.pdf`,
      visibility: "public",
    },
    {
      ...assetBase,
      id: hiddenAssetId,
      storage_path: `security/${hiddenAssetId}.pdf`,
      visibility: "admin_only",
    },
  ]);
  if (assetInsertError) throw assetInsertError;

  const { data: anonPages, error: anonPagesError } = await anon
    .from("site_pages")
    .select("id")
    .in("id", [publicPageId, hiddenPageId]);
  if (anonPagesError) throw anonPagesError;
  assert.deepEqual(anonPages.map((row) => row.id), [publicPageId]);

  const { data: anonRelations, error: anonRelationsError } = await anon
    .from("contest_group_pages")
    .select("page_id")
    .eq("contest_group_id", contestGroupId);
  if (anonRelationsError) throw anonRelationsError;
  assert.deepEqual(anonRelations.map((row) => row.page_id), [publicPageId]);

  const { data: anonAssets, error: anonAssetsError } = await anon
    .from("page_assets")
    .select("id")
    .in("id", [publicAssetId, hiddenAssetId]);
  if (anonAssetsError) throw anonAssetsError;
  assert.deepEqual(anonAssets.map((row) => row.id), [publicAssetId]);

  const { error: storagePathError } = await anon
    .from("page_assets")
    .select("storage_path")
    .eq("id", publicAssetId);
  assert.ok(storagePathError, "anon unexpectedly read storage_path");

  const { error: signInError } = await normalUser.auth.signInWithPassword({
    email: "user@buttervote.local",
    password: "ButterVoteUser123!",
  });
  if (signInError) throw signInError;

  const { data: pageUpdateRows, error: pageUpdateError } = await normalUser
    .from("site_pages")
    .update({ title: "Unauthorized update" })
    .eq("id", publicPageId)
    .select("id");
  assert.ok(
    pageUpdateError || pageUpdateRows?.length === 0,
    "normal user unexpectedly updated a page",
  );

  const { data: assetUpdateRows, error: assetUpdateError } = await normalUser
    .from("page_assets")
    .update({ visibility: "admin_only" })
    .eq("id", publicAssetId)
    .select("id");
  assert.ok(
    assetUpdateError || assetUpdateRows?.length === 0,
    "normal user unexpectedly updated an asset",
  );

  const { data: pageDeleteRows, error: pageDeleteError } = await normalUser
    .from("site_pages")
    .delete()
    .eq("id", publicPageId)
    .select("id");
  assert.ok(
    pageDeleteError || pageDeleteRows?.length === 0,
    "normal user unexpectedly deleted a page",
  );

  console.log(
    JSON.stringify({
      ok: true,
      checks: [
        "anon_page_visibility",
        "anon_asset_visibility",
        "storage_path_column_privilege",
        "normal_user_page_update_denied",
        "normal_user_asset_update_denied",
        "normal_user_page_delete_denied",
        "admin_only_group_page_link_denied",
        "linked_page_visibility_downgrade_denied",
        "anon_public_group_page_relation_visible",
      ],
    }),
  );
} finally {
  await service.from("page_assets").delete().in("id", [publicAssetId, hiddenAssetId]);
  await service.from("contest_groups").delete().eq("id", contestGroupId);
  await service.from("site_pages").delete().in("id", [publicPageId, hiddenPageId]);
}
