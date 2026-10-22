-- Hints only: no scores, event snapshots, metadata, or unpublished result data.
-- Clients still read contest_calling_sessions under its existing RLS policies.
create schema if not exists buttervote_private;

create or replace function buttervote_private.notify_calling_refresh(
  p_contest_id uuid,
  p_include_dependents boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_id uuid;
begin
  for affected_id in
    with recursive affected(id) as (
      select p_contest_id
      union
      select candidate.contest_id
      from affected
      join public.candidates as source on source.contest_id = affected.id
      join public.candidates as candidate on candidate.inherited_from_candidate_id = source.id
      where p_include_dependents and candidate.is_active
    )
    select id from affected where id is not null
  loop
    perform realtime.send('{}'::jsonb, 'calling_changed',
      'buttervote:calling:' || affected_id::text, true);
  end loop;
end;
$$;

create or replace function buttervote_private.broadcast_calling_refresh()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'contest_calling_sessions' then
    if tg_op = 'DELETE' then
      perform buttervote_private.notify_calling_refresh(old.contest_id, true);
    elsif tg_op = 'INSERT' then
      perform buttervote_private.notify_calling_refresh(new.contest_id, true);
    else
      -- Step changes affect this contest; status changes can hide downstream rounds.
      perform buttervote_private.notify_calling_refresh(new.contest_id,
        old.status is distinct from new.status or old.contest_id is distinct from new.contest_id
        or old.archived_at is distinct from new.archived_at);
      if old.contest_id is distinct from new.contest_id then
        perform buttervote_private.notify_calling_refresh(old.contest_id, true);
      end if;
    end if;
  elsif tg_table_name = 'contests' then
    if tg_op = 'DELETE' then
      perform buttervote_private.notify_calling_refresh(old.id, true);
    else
      perform buttervote_private.notify_calling_refresh(new.id, true);
    end if;
  else
    -- Inheritance changes can also revoke visibility of a round being watched.
    if tg_op <> 'INSERT' then
      perform buttervote_private.notify_calling_refresh(old.contest_id, true);
    end if;
    if tg_op = 'INSERT' then
      perform buttervote_private.notify_calling_refresh(new.contest_id, true);
    elsif tg_op = 'UPDATE' and old.contest_id is distinct from new.contest_id then
      perform buttervote_private.notify_calling_refresh(new.contest_id, true);
    end if;
  end if;
  return null;
end;
$$;

revoke all on function buttervote_private.notify_calling_refresh(uuid, boolean)
  from public, anon, authenticated;
revoke all on function buttervote_private.broadcast_calling_refresh()
  from public, anon, authenticated;

create trigger broadcast_calling_session_refresh
after insert or update or delete on public.contest_calling_sessions
for each row execute function buttervote_private.broadcast_calling_refresh();

create trigger broadcast_calling_contest_refresh
after update of status, archived_at, closed_result_visibility, live_results_enabled
or delete on public.contests
for each row execute function buttervote_private.broadcast_calling_refresh();

create trigger broadcast_calling_dependency_refresh
after insert or update of contest_id, is_active, inherited_from_candidate_id
or delete on public.candidates
for each row execute function buttervote_private.broadcast_calling_refresh();

-- Private subscriptions work for guests too, with the anon JWT. Authorize joins
-- against the same readable sessions as the fallback query, including admin RLS.
create policy "Viewers can receive calling refresh hints"
on realtime.messages for select to anon, authenticated
using (
  extension = 'broadcast'
  and exists (
    select 1 from public.contest_calling_sessions as session
    where session.contest_id = case
      when (select realtime.topic()) ~ '^buttervote:calling:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part((select realtime.topic()), ':', 3)::uuid
      else null
    end
  )
);

-- Keep this namespace server-only, even if another feature later allows sending.
create policy "Clients cannot send calling refresh hints"
on realtime.messages as restrictive for insert to anon, authenticated
with check ((select realtime.topic()) not like 'buttervote:calling:%');
