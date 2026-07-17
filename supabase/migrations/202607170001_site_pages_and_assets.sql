create table if not exists public.site_pages (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  slug text not null,
  content_markdown text not null default '',
  visibility text not null default 'admin_only',
  published_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_pages_title_length_check
    check (char_length(trim(title)) between 1 and 160),
  constraint site_pages_description_length_check
    check (description is null or char_length(description) <= 500),
  constraint site_pages_slug_length_check
    check (char_length(slug) between 1 and 120),
  constraint site_pages_slug_format_check
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint site_pages_content_length_check
    check (char_length(content_markdown) <= 1000000),
  constraint site_pages_visibility_check
    check (visibility in ('admin_only', 'public'))
);

create unique index if not exists site_pages_slug_unique_idx
  on public.site_pages(slug);
create index if not exists site_pages_admin_updated_idx
  on public.site_pages(updated_at desc);
create index if not exists site_pages_public_published_idx
  on public.site_pages(published_at desc)
  where visibility = 'public';

drop trigger if exists set_site_pages_updated_at on public.site_pages;
create trigger set_site_pages_updated_at
before update on public.site_pages
for each row
execute function public.set_updated_at();

create or replace function public.set_site_page_first_published_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.visibility = 'public' and new.published_at is null then
    new.published_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists set_site_page_first_published_at on public.site_pages;
create trigger set_site_page_first_published_at
before insert or update of visibility on public.site_pages
for each row
execute function public.set_site_page_first_published_at();

alter table public.site_pages enable row level security;

-- SECURITY CRITICAL: non-admins must never read admin-only page content.
drop policy if exists "Anyone can read public site pages" on public.site_pages;
create policy "Anyone can read public site pages"
on public.site_pages
for select
to anon, authenticated
using (visibility = 'public' or public.is_admin());

drop policy if exists "Admins can create site pages" on public.site_pages;
create policy "Admins can create site pages"
on public.site_pages
for insert
to authenticated
with check (public.is_admin());

drop policy if exists "Admins can update site pages" on public.site_pages;
create policy "Admins can update site pages"
on public.site_pages
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

grant select on public.site_pages to anon, authenticated;
grant insert, update on public.site_pages to authenticated;
revoke delete on public.site_pages from anon, authenticated;

create table if not exists public.page_assets (
  id uuid primary key default gen_random_uuid(),
  original_filename text not null,
  storage_path text not null unique,
  extension text not null,
  mime_type text not null,
  byte_size bigint not null,
  asset_type text not null,
  visibility text not null default 'admin_only',
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint page_assets_filename_length_check
    check (char_length(original_filename) between 1 and 255),
  constraint page_assets_storage_path_length_check
    check (char_length(storage_path) between 1 and 500),
  constraint page_assets_extension_check
    check (extension in ('jpg', 'png', 'webp', 'pdf', '7z', 'rar', 'xlsx', 'docx', 'pptx')),
  constraint page_assets_type_check
    check (asset_type in ('image', 'attachment')),
  constraint page_assets_visibility_check
    check (visibility in ('admin_only', 'public')),
  constraint page_assets_size_check
    check (
      byte_size > 0
      and (
        (asset_type = 'image' and byte_size <= 10485760)
        or
        (asset_type = 'attachment' and byte_size <= 52428800)
      )
    ),
  constraint page_assets_type_metadata_check
    check (
      (
        asset_type = 'image'
        and (
          (extension = 'jpg' and mime_type = 'image/jpeg')
          or (extension = 'png' and mime_type = 'image/png')
          or (extension = 'webp' and mime_type = 'image/webp')
        )
      )
      or
      (
        asset_type = 'attachment'
        and (
          (extension = 'pdf' and mime_type = 'application/pdf')
          or (extension = '7z' and mime_type = 'application/x-7z-compressed')
          or (extension = 'rar' and mime_type = 'application/x-rar-compressed')
          or (
            extension = 'xlsx'
            and mime_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          )
          or (
            extension = 'docx'
            and mime_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          )
          or (
            extension = 'pptx'
            and mime_type = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
          )
        )
      )
    )
);

create index if not exists page_assets_admin_created_idx
  on public.page_assets(created_at desc);
create index if not exists page_assets_visibility_created_idx
  on public.page_assets(visibility, created_at desc);
create index if not exists page_assets_type_created_idx
  on public.page_assets(asset_type, created_at desc);

drop trigger if exists set_page_assets_updated_at on public.page_assets;
create trigger set_page_assets_updated_at
before update on public.page_assets
for each row
execute function public.set_updated_at();

alter table public.page_assets enable row level security;

-- SECURITY CRITICAL: asset metadata visibility is enforced independently of pages.
drop policy if exists "Anyone can read visible page assets" on public.page_assets;
create policy "Anyone can read visible page assets"
on public.page_assets
for select
to anon, authenticated
using (visibility = 'public' or public.is_admin());

drop policy if exists "Admins can create page assets" on public.page_assets;
create policy "Admins can create page assets"
on public.page_assets
for insert
to authenticated
with check (public.is_admin());

drop policy if exists "Admins can update page assets" on public.page_assets;
create policy "Admins can update page assets"
on public.page_assets
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

grant select on public.page_assets to anon, authenticated;
grant insert, update on public.page_assets to authenticated;
revoke delete on public.page_assets from anon, authenticated;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'page-assets',
  'page-assets',
  false,
  52428800,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
    'application/x-7z-compressed',
    'application/x-rar-compressed',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- No storage.objects policy is added. All object access goes through reviewed
-- server routes using the service role after page_assets visibility checks.
