create table if not exists public.contest_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  cover_image_path text,
  cover_image_width int,
  cover_image_height int,
  cover_image_size int,
  love_vote_weight numeric not null default 3,
  love_vote_quota int not null default 1,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (love_vote_weight > 0),
  check (love_vote_quota >= 0)
);

alter table public.contests
  add column if not exists group_id uuid references public.contest_groups(id) on delete set null,
  add column if not exists show_candidate_image boolean not null default true,
  add column if not exists show_candidate_description boolean not null default true;

alter table public.contests
  drop constraint if exists contests_status_check;

alter table public.contests
  add constraint contests_status_check
  check (status in ('draft', 'nominating', 'admin_nominating', 'voting', 'closed', 'published'));

alter table public.candidates
  add column if not exists inherited_from_candidate_id uuid references public.candidates(id);

create table if not exists public.love_vote_allocations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.contest_groups(id) on delete cascade,
  contest_id uuid not null references public.contests(id) on delete cascade,
  vote_id uuid not null references public.votes(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  voter_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.site_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists contest_groups_created_at_idx
  on public.contest_groups(created_at desc);
create index if not exists contests_group_idx
  on public.contests(group_id);
create index if not exists candidates_inherited_from_idx
  on public.candidates(inherited_from_candidate_id);
create unique index if not exists candidates_unique_inherited_source_per_contest
  on public.candidates(contest_id, inherited_from_candidate_id)
  where inherited_from_candidate_id is not null;
create index if not exists love_vote_allocations_group_voter_idx
  on public.love_vote_allocations(group_id, voter_id);
create index if not exists love_vote_allocations_contest_idx
  on public.love_vote_allocations(contest_id);
create index if not exists love_vote_allocations_vote_idx
  on public.love_vote_allocations(vote_id);
create unique index if not exists love_vote_allocations_unique_vote_candidate
  on public.love_vote_allocations(vote_id, candidate_id);

drop trigger if exists set_contest_groups_updated_at on public.contest_groups;
create trigger set_contest_groups_updated_at
before update on public.contest_groups
for each row
execute function public.set_updated_at();

create or replace function public.set_site_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_site_settings_updated_at on public.site_settings;
create trigger set_site_settings_updated_at
before update on public.site_settings
for each row
execute function public.set_site_settings_updated_at();

create or replace function public.get_contest_love_vote_allocations(p_contest_id uuid)
returns table (
  vote_id uuid,
  candidate_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select l.vote_id, l.candidate_id
  from public.love_vote_allocations l
  join public.contests c on c.id = l.contest_id
  where l.contest_id = p_contest_id
    and c.status in ('closed', 'published')
  order by l.created_at asc;
$$;

alter table public.contest_groups enable row level security;
alter table public.love_vote_allocations enable row level security;
alter table public.site_settings enable row level security;

drop policy if exists "Anyone can read contest groups" on public.contest_groups;
create policy "Anyone can read contest groups"
on public.contest_groups
for select
to anon, authenticated
using (true);

drop policy if exists "Admins can manage contest groups" on public.contest_groups;
create policy "Admins can manage contest groups"
on public.contest_groups
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Anyone can read public contests" on public.contests;
create policy "Anyone can read public contests"
on public.contests
for select
to anon, authenticated
using (status <> 'draft');

drop policy if exists "Users can read own love votes" on public.love_vote_allocations;
create policy "Users can read own love votes"
on public.love_vote_allocations
for select
to authenticated
using (auth.uid() = voter_id);

drop policy if exists "Users can create own love votes" on public.love_vote_allocations;
create policy "Users can create own love votes"
on public.love_vote_allocations
for insert
to authenticated
with check (auth.uid() = voter_id);

drop policy if exists "Admins can read all love votes" on public.love_vote_allocations;
create policy "Admins can read all love votes"
on public.love_vote_allocations
for select
to authenticated
using (public.is_admin());

drop policy if exists "Anyone can read site settings" on public.site_settings;
create policy "Anyone can read site settings"
on public.site_settings
for select
to anon, authenticated
using (true);

drop policy if exists "Admins can manage site settings" on public.site_settings;
create policy "Admins can manage site settings"
on public.site_settings
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

grant select on public.contest_groups to anon, authenticated;
grant insert, update, delete on public.contest_groups to authenticated;

grant select, insert on public.love_vote_allocations to authenticated;

grant select on public.site_settings to anon, authenticated;
grant insert, update, delete on public.site_settings to authenticated;

grant execute on function public.get_contest_love_vote_allocations(uuid) to anon, authenticated;

-- Storage policy note:
-- The existing vote-images bucket and "Admins can manage vote images" policy
-- already cover groups/{groupId}/cover.webp and homepage/hero.webp because both
-- files are written by admins. Public reads continue through "Anyone can read
-- vote images".
