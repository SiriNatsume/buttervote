create table if not exists public.contest_calling_sessions (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references public.contests(id) on delete cascade,
  status text not null default 'draft' check (
    status in ('draft', 'active', 'paused', 'completed', 'archived')
  ),
  current_step int not null default 0 check (current_step >= 0),
  total_steps int not null default 0 check (total_steps >= 0),
  play_mode text not null default 'manual' check (play_mode in ('manual', 'auto')),
  auto_interval_seconds int not null default 5 check (
    auto_interval_seconds between 2 and 60
  ),
  seed text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  started_at timestamptz,
  completed_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.contest_calling_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.contest_calling_sessions(id) on delete cascade,
  contest_id uuid not null references public.contests(id) on delete cascade,
  sequence int not null check (sequence >= 1),
  phase text not null check (phase in ('base', 'love_bonus')),
  candidate_id uuid references public.candidates(id) on delete set null,
  delta_score numeric not null default 0,
  candidate_snapshot jsonb not null default '{}'::jsonb,
  scores jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(session_id, sequence)
);

create index if not exists contest_calling_sessions_contest_status_idx
  on public.contest_calling_sessions(contest_id, status, created_at desc)
  where archived_at is null;

create index if not exists contest_calling_events_session_sequence_idx
  on public.contest_calling_events(session_id, sequence);

create index if not exists contest_calling_events_contest_idx
  on public.contest_calling_events(contest_id);

drop trigger if exists set_contest_calling_sessions_updated_at
on public.contest_calling_sessions;
create trigger set_contest_calling_sessions_updated_at
before update on public.contest_calling_sessions
for each row
execute function public.set_updated_at();

alter table public.contest_calling_sessions enable row level security;
alter table public.contest_calling_events enable row level security;

drop policy if exists "Anyone can read public calling sessions"
on public.contest_calling_sessions;
create policy "Anyone can read public calling sessions"
on public.contest_calling_sessions
for select
to anon, authenticated
using (
  archived_at is null
  and status in ('active', 'paused', 'completed')
  and exists (
    select 1
    from public.contests c
    where c.id = contest_calling_sessions.contest_id
      and c.archived_at is null
  )
);

drop policy if exists "Anyone can read public calling events"
on public.contest_calling_events;
create policy "Anyone can read public calling events"
on public.contest_calling_events
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.contest_calling_sessions s
    join public.contests c on c.id = s.contest_id
    where s.id = contest_calling_events.session_id
      and s.archived_at is null
      and s.status in ('active', 'paused', 'completed')
      and c.archived_at is null
  )
);

drop policy if exists "Admins can manage calling sessions"
on public.contest_calling_sessions;
create policy "Admins can manage calling sessions"
on public.contest_calling_sessions
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Admins can manage calling events"
on public.contest_calling_events;
create policy "Admins can manage calling events"
on public.contest_calling_events
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

revoke all on public.contest_calling_sessions from anon, authenticated;
revoke all on public.contest_calling_events from anon, authenticated;

grant select on public.contest_calling_sessions to anon, authenticated;
grant select on public.contest_calling_events to anon, authenticated;
grant insert, update, delete on public.contest_calling_sessions to authenticated;
grant insert, update, delete on public.contest_calling_events to authenticated;
