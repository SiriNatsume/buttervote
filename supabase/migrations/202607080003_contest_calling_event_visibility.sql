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
      and c.archived_at is null
      and (
        s.status = 'completed'
        or (
          s.status in ('active', 'paused')
          and contest_calling_events.sequence <= s.current_step
        )
      )
  )
);
