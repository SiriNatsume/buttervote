alter table public.contests
  add column if not exists image_path text,
  add column if not exists image_width int,
  add column if not exists image_height int,
  add column if not exists image_size int;

alter table public.nominations
  add column if not exists image_path text,
  add column if not exists image_width int,
  add column if not exists image_height int,
  add column if not exists image_size int;

alter table public.candidates
  add column if not exists image_path text,
  add column if not exists image_width int,
  add column if not exists image_height int,
  add column if not exists image_size int;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'vote-images',
  'vote-images',
  true,
  1048576,
  array['image/webp', 'image/jpeg']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Anyone can read vote images" on storage.objects;
create policy "Anyone can read vote images"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'vote-images');

drop policy if exists "Admins can manage vote images" on storage.objects;
create policy "Admins can manage vote images"
on storage.objects
for all
to authenticated
using (bucket_id = 'vote-images' and public.is_admin())
with check (bucket_id = 'vote-images' and public.is_admin());

drop policy if exists "Users can upload own nomination images" on storage.objects;
create policy "Users can upload own nomination images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'vote-images'
  and name ~ '^nominations/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/image\.webp$'
  and exists (
    select 1
    from public.nominations n
    where n.id = (
      case
        when name ~ '^nominations/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/image\.webp$'
          then split_part(name, '/', 2)::uuid
        else null
      end
    )
    and n.submitter_id = auth.uid()
  )
);

drop policy if exists "Users can update own nomination images" on storage.objects;
create policy "Users can update own nomination images"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'vote-images'
  and name ~ '^nominations/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/image\.webp$'
  and exists (
    select 1
    from public.nominations n
    where n.id = (
      case
        when name ~ '^nominations/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/image\.webp$'
          then split_part(name, '/', 2)::uuid
        else null
      end
    )
    and n.submitter_id = auth.uid()
  )
)
with check (
  bucket_id = 'vote-images'
  and name ~ '^nominations/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/image\.webp$'
  and exists (
    select 1
    from public.nominations n
    where n.id = (
      case
        when name ~ '^nominations/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/image\.webp$'
          then split_part(name, '/', 2)::uuid
        else null
      end
    )
    and n.submitter_id = auth.uid()
  )
);

-- MVP policy note:
-- This allows nomination owners to update their own nomination row so the
-- Server Action can save image metadata with the user's session. Because the
-- project currently grants UPDATE on nominations to authenticated users as a
-- table privilege, a stricter production version should move this write into a
-- SECURITY DEFINER RPC or split grants by role.
drop policy if exists "Users can update own nomination images metadata" on public.nominations;
create policy "Users can update own nomination images metadata"
on public.nominations
for update
to authenticated
using (auth.uid() = submitter_id)
with check (auth.uid() = submitter_id);
