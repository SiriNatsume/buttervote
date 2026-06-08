create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.contests (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  status text not null default 'draft' check (
    status in ('draft', 'nominating', 'voting', 'closed', 'published')
  ),
  vote_type text not null default 'single' check (
    vote_type in ('single', 'multiple', 'ranked')
  ),
  max_choices int not null default 1 check (max_choices >= 1),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.nominations (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.contests(id) on delete cascade,
  submitter_id uuid references public.profiles(id),
  name text not null,
  description text,
  status text not null default 'pending' check (
    status in ('pending', 'approved', 'rejected')
  ),
  created_at timestamptz not null default now()
);

create table if not exists public.candidates (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.contests(id) on delete cascade,
  nomination_id uuid references public.nominations(id),
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.votes (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.contests(id) on delete cascade,
  voter_id uuid references public.profiles(id),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (contest_id, voter_id)
);

create index if not exists contests_status_idx on public.contests(status);
create index if not exists contests_created_at_idx on public.contests(created_at desc);
create index if not exists nominations_contest_status_idx on public.nominations(contest_id, status);
create index if not exists nominations_submitter_idx on public.nominations(submitter_id);
create index if not exists candidates_contest_idx on public.candidates(contest_id);
create unique index if not exists candidates_nomination_id_key
  on public.candidates(nomination_id)
  where nomination_id is not null;
create index if not exists votes_contest_idx on public.votes(contest_id);
create index if not exists votes_voter_idx on public.votes(voter_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_contests_updated_at on public.contests;
create trigger set_contests_updated_at
before update on public.contests
for each row
execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do update
    set email = excluded.email;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

create or replace function public.get_contest_vote_payloads(p_contest_id uuid)
returns table (
  id uuid,
  contest_id uuid,
  payload jsonb,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select v.id, v.contest_id, v.payload, v.created_at
  from public.votes v
  join public.contests c on c.id = v.contest_id
  where v.contest_id = p_contest_id
    and c.status in ('closed', 'published')
  order by v.created_at asc;
$$;

alter table public.profiles enable row level security;
alter table public.contests enable row level security;
alter table public.nominations enable row level security;
alter table public.candidates enable row level security;
alter table public.votes enable row level security;

drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

drop policy if exists "Admins can read all profiles" on public.profiles;
create policy "Admins can read all profiles"
on public.profiles
for select
to authenticated
using (public.is_admin());

drop policy if exists "Users can update own display name" on public.profiles;
create policy "Users can update own display name"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "Anyone can read public contests" on public.contests;
create policy "Anyone can read public contests"
on public.contests
for select
to anon, authenticated
using (status <> 'draft');

drop policy if exists "Admins can manage all contests" on public.contests;
create policy "Admins can manage all contests"
on public.contests
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Users can create own nominations" on public.nominations;
create policy "Users can create own nominations"
on public.nominations
for insert
to authenticated
with check (auth.uid() = submitter_id);

drop policy if exists "Users can read own nominations" on public.nominations;
create policy "Users can read own nominations"
on public.nominations
for select
to authenticated
using (auth.uid() = submitter_id);

drop policy if exists "Admins can read all nominations" on public.nominations;
create policy "Admins can read all nominations"
on public.nominations
for select
to authenticated
using (public.is_admin());

drop policy if exists "Admins can update all nominations" on public.nominations;
create policy "Admins can update all nominations"
on public.nominations
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Anyone can read candidates" on public.candidates;
create policy "Anyone can read candidates"
on public.candidates
for select
to anon, authenticated
using (true);

drop policy if exists "Admins can manage candidates" on public.candidates;
create policy "Admins can manage candidates"
on public.candidates
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Users can create own votes" on public.votes;
create policy "Users can create own votes"
on public.votes
for insert
to authenticated
with check (auth.uid() = voter_id);

drop policy if exists "Users can read own votes" on public.votes;
create policy "Users can read own votes"
on public.votes
for select
to authenticated
using (auth.uid() = voter_id);

drop policy if exists "Admins can read all votes" on public.votes;
create policy "Admins can read all votes"
on public.votes
for select
to authenticated
using (public.is_admin());

revoke all on public.profiles from anon, authenticated;
revoke all on public.contests from anon, authenticated;
revoke all on public.nominations from anon, authenticated;
revoke all on public.candidates from anon, authenticated;
revoke all on public.votes from anon, authenticated;

grant select on public.contests to anon, authenticated;
grant select on public.candidates to anon, authenticated;

grant select on public.profiles to authenticated;
grant update(display_name) on public.profiles to authenticated;

grant insert, update, delete on public.contests to authenticated;
grant select, insert, update on public.nominations to authenticated;
grant insert, update, delete on public.candidates to authenticated;
grant select, insert on public.votes to authenticated;

grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.get_contest_vote_payloads(uuid) to anon, authenticated;
