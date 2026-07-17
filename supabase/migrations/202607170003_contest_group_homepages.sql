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

create index if not exists contests_group_recent_results_idx
  on public.contests(
    group_id,
    (coalesce(voting_ends_at, updated_at)) desc
  )
  where archived_at is null
    and status in ('closed', 'published');

-- Keep the public group homepage bounded: return every active contest, plus a
-- capped recent-results window ordered by the same timestamp used by the UI.
create or replace function public.get_group_homepage_contests(
  p_group_id uuid,
  p_recent_limit integer default 20
)
returns setof public.contests
language sql
stable
security invoker
set search_path = ''
as $$
  (
    select contest.*
    from public.contests as contest
    where contest.group_id = p_group_id
      and contest.archived_at is null
      and contest.status in (
        'nominating',
        'admin_nominating',
        'waiting',
        'voting'
      )
  )
  union all
  (
    select contest.*
    from public.contests as contest
    where contest.group_id = p_group_id
      and contest.archived_at is null
      and contest.status in ('closed', 'published')
    order by coalesce(contest.voting_ends_at, contest.updated_at) desc,
      contest.id
    limit least(greatest(coalesce(p_recent_limit, 20), 1), 50)
  );
$$;

revoke all on function public.get_group_homepage_contests(uuid, integer)
from public, anon, authenticated;
grant execute on function public.get_group_homepage_contests(uuid, integer)
to anon, authenticated;

-- Aggregate visible vote payloads in Postgres so a public homepage request
-- never transfers and replays the full raw vote history inside the Worker.
create or replace function public.get_visible_contest_tallies(
  p_contest_ids uuid[],
  p_include_admin_override boolean default false
)
returns table (
  contest_id uuid,
  candidate_id uuid,
  score double precision,
  normal_score double precision,
  love_score double precision,
  love_vote_count integer,
  last_vote_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with visibility as (
    select visible.*
    from public.get_contest_result_visibility(
      coalesce(p_contest_ids, array[]::uuid[]),
      p_include_admin_override
    ) as visible
    where visible.full_results_visible
  ),
  visible_votes as (
    select vote.*, contest.vote_type
    from public.get_visible_contest_vote_payloads(
      coalesce(p_contest_ids, array[]::uuid[]),
      p_include_admin_override
    ) as vote
    join public.contests as contest on contest.id = vote.contest_id
  ),
  expanded_points as (
    select
      vote.id as vote_id,
      vote.contest_id,
      vote.payload ->> 'candidateId' as candidate_id_text,
      1::double precision as points,
      vote.created_at
    from visible_votes as vote
    where vote.vote_type = 'single'

    union all

    select
      vote.id,
      vote.contest_id,
      selected.candidate_id_text,
      1::double precision,
      vote.created_at
    from visible_votes as vote
    cross join lateral jsonb_array_elements_text(
      case
        when jsonb_typeof(vote.payload -> 'candidateIds') = 'array'
          then vote.payload -> 'candidateIds'
        else '[]'::jsonb
      end
    ) as selected(candidate_id_text)
    where vote.vote_type = 'multiple'

    union all

    select
      vote.id,
      vote.contest_id,
      ranked.candidate_id_text,
      (4 - ranked.ordinality)::double precision,
      vote.created_at
    from visible_votes as vote
    cross join lateral jsonb_array_elements_text(
      case
        when jsonb_typeof(vote.payload -> 'ranking') = 'array'
          then vote.payload -> 'ranking'
        else '[]'::jsonb
      end
    ) with ordinality as ranked(candidate_id_text, ordinality)
    where vote.vote_type = 'ranked'
      and ranked.ordinality <= 3
  ),
  eligible_points as (
    select
      point.vote_id,
      point.contest_id,
      candidate.id as candidate_id,
      point.points,
      point.created_at
    from expanded_points as point
    join public.candidates as candidate
      on candidate.contest_id = point.contest_id
     and candidate.id::text = point.candidate_id_text
     and candidate.is_active
  ),
  visible_allocations as (
    select allocation.*
    from public.get_visible_contest_love_vote_allocations(
      coalesce(p_contest_ids, array[]::uuid[]),
      p_include_admin_override
    ) as allocation
  ),
  candidate_scores as (
    select
      candidate.contest_id,
      candidate.id as candidate_id,
      coalesce(
        sum(point.points) filter (where allocation.vote_id is null),
        0
      )::double precision as normal_score,
      coalesce(
        sum(point.points * contest_group.love_vote_weight)
          filter (where allocation.vote_id is not null),
        0
      )::double precision as love_score,
      count(allocation.vote_id)::integer as love_vote_count,
      max(point.created_at) as last_vote_at
    from visibility
    join public.contests as contest on contest.id = visibility.contest_id
    join public.contest_groups as contest_group
      on contest_group.id = contest.group_id
    join public.candidates as candidate
      on candidate.contest_id = contest.id
     and candidate.is_active
    left join eligible_points as point
      on point.contest_id = candidate.contest_id
     and point.candidate_id = candidate.id
    left join visible_allocations as allocation
      on allocation.contest_id = point.contest_id
     and allocation.vote_id = point.vote_id
     and allocation.candidate_id = point.candidate_id
    group by candidate.contest_id, candidate.id
  )
  select
    candidate_scores.contest_id,
    candidate_scores.candidate_id,
    candidate_scores.normal_score + candidate_scores.love_score as score,
    candidate_scores.normal_score,
    candidate_scores.love_score,
    candidate_scores.love_vote_count,
    candidate_scores.last_vote_at
  from candidate_scores;
$$;

revoke all on function public.get_visible_contest_tallies(uuid[], boolean)
from public, anon, authenticated;
grant execute on function public.get_visible_contest_tallies(uuid[], boolean)
to anon, authenticated;
