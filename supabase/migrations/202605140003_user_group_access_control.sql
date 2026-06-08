create table if not exists public.user_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  join_code text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_group_members (
  id uuid primary key default gen_random_uuid(),
  user_group_id uuid not null references public.user_groups(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  source text not null default 'qq_ticket',
  joined_at timestamptz not null default now(),
  last_verified_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  unique(user_group_id, profile_id)
);

create table if not exists public.contest_group_allowed_user_groups (
  id uuid primary key default gen_random_uuid(),
  contest_group_id uuid not null references public.contest_groups(id) on delete cascade,
  user_group_id uuid not null references public.user_groups(id) on delete cascade,
  unique(contest_group_id, user_group_id)
);

alter table public.contest_groups
  add column if not exists access_mode text not null default 'public';

alter table public.contest_groups
  drop constraint if exists contest_groups_access_mode_check;

alter table public.contest_groups
  add constraint contest_groups_access_mode_check
  check (access_mode in ('public', 'restricted'));

alter table public.qq_login_tickets
  add column if not exists user_group_join_codes text[] not null default '{}';

create index if not exists idx_user_group_members_profile_id
  on public.user_group_members(profile_id);

create index if not exists idx_user_group_members_user_group_id
  on public.user_group_members(user_group_id);

create index if not exists idx_user_group_members_validity
  on public.user_group_members(profile_id, revoked_at, expires_at);

create index if not exists idx_user_group_members_expires_at
  on public.user_group_members(expires_at);

create index if not exists idx_user_groups_join_code
  on public.user_groups(join_code);

create index if not exists idx_contest_group_allowed_user_groups_group
  on public.contest_group_allowed_user_groups(contest_group_id);

create index if not exists idx_contest_group_allowed_user_groups_user_group
  on public.contest_group_allowed_user_groups(user_group_id);

drop trigger if exists set_user_groups_updated_at on public.user_groups;
create trigger set_user_groups_updated_at
before update on public.user_groups
for each row
execute function public.set_updated_at();

alter table public.user_groups enable row level security;
alter table public.user_group_members enable row level security;
alter table public.contest_group_allowed_user_groups enable row level security;

drop policy if exists "Admins can manage user groups" on public.user_groups;
create policy "Admins can manage user groups"
on public.user_groups
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Admins can manage user group members" on public.user_group_members;
create policy "Admins can manage user group members"
on public.user_group_members
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Users can read own user group memberships" on public.user_group_members;
create policy "Users can read own user group memberships"
on public.user_group_members
for select
to authenticated
using (auth.uid() = profile_id);

drop policy if exists "Admins can manage contest group user group access" on public.contest_group_allowed_user_groups;
create policy "Admins can manage contest group user group access"
on public.contest_group_allowed_user_groups
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

grant select, insert, update, delete on public.user_groups to authenticated;
grant select, insert, update, delete on public.user_group_members to authenticated;
grant select, insert, update, delete on public.contest_group_allowed_user_groups to authenticated;
