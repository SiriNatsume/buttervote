-- SECURITY CRITICAL: public asset metadata must not expose internal Storage
-- paths. The stable /api/page-assets/{id} route resolves them server-side.
revoke select on public.page_assets from anon, authenticated;

grant select (
  id,
  original_filename,
  extension,
  mime_type,
  byte_size,
  asset_type,
  visibility,
  created_at,
  updated_at
) on public.page_assets to anon, authenticated;
