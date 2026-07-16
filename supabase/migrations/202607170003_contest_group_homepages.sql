create table if not exists public.contest_group_homepage_settings (
  contest_group_id uuid primary key references public.contest_groups(id) on delete cascade,
  show_bracket boolean not null default false,
  featured_tournament_id uuid references public.tournaments(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.contest_group_pages (
  id uuid primary key default gen_random_uuid(),
  contest_group_id uuid not null references public.contest_groups(id) on delete cascade,
  page_id uuid not null references public.site_pages(id) on delete restrict,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  unique (contest_group_id, page_id)
);

create index if not exists contest_group_pages_group_order_idx
  on public.contest_group_pages(contest_group_id, sort_order, created_at);
create index if not exists contest_group_pages_page_idx
  on public.contest_group_pages(page_id);

drop trigger if exists set_contest_group_homepage_settings_updated_at
on public.contest_group_homepage_settings;
create trigger set_contest_group_homepage_settings_updated_at
before update on public.contest_group_homepage_settings
for each row execute function public.set_updated_at();

create or replace function public.validate_contest_group_homepage_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.featured_tournament_id is not null and not exists (
    select 1
    from public.tournament_stages as stage
    where stage.tournament_id = new.featured_tournament_id
      and stage.group_id = new.contest_group_id
  ) and not exists (
    select 1
    from public.tournament_matches as match
    join public.contests as contest on contest.id = match.contest_id
    where match.tournament_id = new.featured_tournament_id
      and contest.group_id = new.contest_group_id
  ) then
    raise exception '首页对阵图赛事必须属于当前活动组。';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_contest_group_homepage_settings_trigger
on public.contest_group_homepage_settings;
create trigger validate_contest_group_homepage_settings_trigger
before insert or update on public.contest_group_homepage_settings
for each row execute function public.validate_contest_group_homepage_settings();

create or replace function public.validate_contest_group_page()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.site_pages as page
    where page.id = new.page_id
      and page.visibility = 'public'
  ) then
    raise exception '活动组只能关联所有人可见的页面。';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_contest_group_page_trigger
on public.contest_group_pages;
create trigger validate_contest_group_page_trigger
before insert or update on public.contest_group_pages
for each row execute function public.validate_contest_group_page();

create or replace function public.prevent_linked_page_visibility_downgrade()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.visibility = 'public'
    and new.visibility <> 'public'
    and exists (
      select 1
      from public.contest_group_pages as relation
      where relation.page_id = old.id
    ) then
    raise exception '该页面已被活动组关联，请先解除关联后再修改可见性。';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_linked_page_visibility_downgrade_trigger
on public.site_pages;
create trigger prevent_linked_page_visibility_downgrade_trigger
before update of visibility on public.site_pages
for each row execute function public.prevent_linked_page_visibility_downgrade();

-- SECURITY CRITICAL: replacing the complete ordered relation set in one
-- transaction prevents partial saves and revalidates every page as public.
create or replace function public.set_contest_group_pages(
  p_contest_group_id uuid,
  p_page_ids uuid[] default array[]::uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_ids uuid[] := coalesce(p_page_ids, array[]::uuid[]);
begin
  if not exists (
    select 1 from public.contest_groups where id = p_contest_group_id
  ) then
    raise exception '活动组不存在。';
  end if;
  if cardinality(normalized_ids) <> (
    select count(distinct requested.page_id)::integer
    from unnest(normalized_ids) as requested(page_id)
  ) then
    raise exception '关联页面不能重复。';
  end if;
  if exists (
    select 1
    from unnest(normalized_ids) as requested(page_id)
    left join public.site_pages as page
      on page.id = requested.page_id and page.visibility = 'public'
    where page.id is null
  ) then
    raise exception '活动组只能关联所有人可见的页面。';
  end if;

  delete from public.contest_group_pages
  where contest_group_id = p_contest_group_id;

  insert into public.contest_group_pages(contest_group_id, page_id, sort_order)
  select p_contest_group_id, ordered.page_id, ordered.ordinality::integer - 1
  from unnest(normalized_ids) with ordinality as ordered(page_id, ordinality);
end;
$$;

alter table public.contest_group_homepage_settings enable row level security;
alter table public.contest_group_pages enable row level security;

create policy "Anyone can read contest group homepage settings"
on public.contest_group_homepage_settings
for select to anon, authenticated
using (true);

create policy "Admins can manage contest group homepage settings"
on public.contest_group_homepage_settings
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "Anyone can read public contest group pages"
on public.contest_group_pages
for select to anon, authenticated
using (
  exists (
    select 1 from public.site_pages as page
    where page.id = page_id and page.visibility = 'public'
  )
);

create policy "Admins can manage contest group pages"
on public.contest_group_pages
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

grant select on public.contest_group_homepage_settings to anon, authenticated;
grant insert, update, delete on public.contest_group_homepage_settings to authenticated;
grant select on public.contest_group_pages to anon, authenticated;
grant insert, update, delete on public.contest_group_pages to authenticated;

revoke all on function public.set_contest_group_pages(uuid, uuid[])
from public, anon, authenticated;
grant execute on function public.set_contest_group_pages(uuid, uuid[])
to service_role;
