create index if not exists contest_calling_events_candidate_idx
  on public.contest_calling_events(candidate_id)
  where candidate_id is not null;

create index if not exists contest_calling_sessions_created_by_idx
  on public.contest_calling_sessions(created_by)
  where created_by is not null;

drop policy if exists "Admins can manage calling sessions"
on public.contest_calling_sessions;
drop policy if exists "Admins can insert calling sessions"
on public.contest_calling_sessions;
drop policy if exists "Admins can update calling sessions"
on public.contest_calling_sessions;
drop policy if exists "Admins can delete calling sessions"
on public.contest_calling_sessions;

create policy "Admins can insert calling sessions"
on public.contest_calling_sessions
for insert
to authenticated
with check ((select public.is_admin()));

create policy "Admins can update calling sessions"
on public.contest_calling_sessions
for update
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy "Admins can delete calling sessions"
on public.contest_calling_sessions
for delete
to authenticated
using ((select public.is_admin()));

drop policy if exists "Admins can manage calling events"
on public.contest_calling_events;
drop policy if exists "Admins can insert calling events"
on public.contest_calling_events;
drop policy if exists "Admins can update calling events"
on public.contest_calling_events;
drop policy if exists "Admins can delete calling events"
on public.contest_calling_events;

create policy "Admins can insert calling events"
on public.contest_calling_events
for insert
to authenticated
with check ((select public.is_admin()));

create policy "Admins can update calling events"
on public.contest_calling_events
for update
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

create policy "Admins can delete calling events"
on public.contest_calling_events
for delete
to authenticated
using ((select public.is_admin()));
