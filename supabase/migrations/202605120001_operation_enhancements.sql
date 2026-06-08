alter table public.contests
  add column if not exists show_nominator_info boolean not null default true,
  add column if not exists max_nominations_per_user int,
  add column if not exists live_results_enabled boolean not null default false,
  add column if not exists closed_result_visibility text not null default 'admin_only',
  add column if not exists voting_starts_at timestamptz,
  add column if not exists voting_ends_at timestamptz;

alter table public.contests
  drop constraint if exists contests_status_check;

alter table public.contests
  add constraint contests_status_check
  check (
    status in (
      'draft',
      'nominating',
      'admin_nominating',
      'waiting',
      'voting',
      'closed',
      'published'
    )
  );

alter table public.contests
  drop constraint if exists contests_closed_result_visibility_check;

alter table public.contests
  add constraint contests_closed_result_visibility_check
  check (closed_result_visibility in ('admin_only', 'public'));

alter table public.contests
  drop constraint if exists contests_max_nominations_per_user_check;

alter table public.contests
  add constraint contests_max_nominations_per_user_check
  check (max_nominations_per_user is null or max_nominations_per_user >= 0);

alter table public.nominations
  add column if not exists nominator_display_name text,
  add column if not exists nominator_note text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.candidates
  add column if not exists nominator_display_name text,
  add column if not exists nominator_note text,
  add column if not exists is_active boolean not null default true,
  add column if not exists deleted_at timestamptz;

create table if not exists public.contest_scheduled_transitions (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.contests(id) on delete cascade,
  target_status text not null check (
    target_status in (
      'nominating',
      'admin_nominating',
      'waiting',
      'voting',
      'closed',
      'published'
    )
  ),
  run_at timestamptz not null,
  executed_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists candidates_contest_active_idx
  on public.candidates(contest_id, is_active, created_at);

create index if not exists contest_scheduled_transitions_due_idx
  on public.contest_scheduled_transitions(run_at)
  where executed_at is null;

create index if not exists contest_scheduled_transitions_contest_idx
  on public.contest_scheduled_transitions(contest_id, executed_at, run_at);

drop trigger if exists set_nominations_updated_at on public.nominations;
create trigger set_nominations_updated_at
before update on public.nominations
for each row
execute function public.set_updated_at();

drop trigger if exists set_contest_scheduled_transitions_updated_at
on public.contest_scheduled_transitions;
create trigger set_contest_scheduled_transitions_updated_at
before update on public.contest_scheduled_transitions
for each row
execute function public.set_updated_at();

create or replace function public.enforce_scheduled_transition_limits()
returns trigger
language plpgsql
as $$
declare
  pending_count int;
begin
  if new.executed_at is null then
    if new.run_at <= now() then
      raise exception 'run_at must be in the future';
    end if;

    select count(*)
      into pending_count
    from public.contest_scheduled_transitions
    where contest_id = new.contest_id
      and executed_at is null
      and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

    if pending_count >= 2 then
      raise exception 'each contest can have at most two pending scheduled transitions';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_scheduled_transition_limits_trigger
on public.contest_scheduled_transitions;
create trigger enforce_scheduled_transition_limits_trigger
before insert or update on public.contest_scheduled_transitions
for each row
execute function public.enforce_scheduled_transition_limits();

create or replace function public.can_view_contest_results(p_contest_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.contests c
    where c.id = p_contest_id
      and (
        public.is_admin()
        or c.status = 'published'
        or (c.status = 'closed' and c.closed_result_visibility = 'public')
        or (c.status = 'voting' and c.live_results_enabled = true)
      )
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
  where v.contest_id = p_contest_id
    and public.can_view_contest_results(p_contest_id)
  order by v.created_at asc;
$$;

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
  where l.contest_id = p_contest_id
    and public.can_view_contest_results(p_contest_id)
  order by l.created_at asc;
$$;

alter table public.contest_scheduled_transitions enable row level security;

drop policy if exists "Anyone can read candidates" on public.candidates;
create policy "Anyone can read active candidates"
on public.candidates
for select
to anon, authenticated
using (is_active = true or public.is_admin());

drop policy if exists "Users can update own nomination images metadata" on public.nominations;
drop policy if exists "Users can update own pending nominations" on public.nominations;
create policy "Users can update own pending nominations"
on public.nominations
for update
to authenticated
using (
  auth.uid() = submitter_id
  and status in ('pending', 'rejected')
)
with check (
  auth.uid() = submitter_id
  and status in ('pending', 'rejected')
);

drop policy if exists "Admins can manage scheduled transitions"
on public.contest_scheduled_transitions;
create policy "Admins can manage scheduled transitions"
on public.contest_scheduled_transitions
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

revoke all on public.contest_scheduled_transitions from anon, authenticated;
grant select, insert, update, delete on public.contest_scheduled_transitions to authenticated;

grant execute on function public.can_view_contest_results(uuid) to anon, authenticated;
grant execute on function public.get_contest_vote_payloads(uuid) to anon, authenticated;
grant execute on function public.get_contest_love_vote_allocations(uuid) to anon, authenticated;
