alter table public.contests
  add column if not exists archived_at timestamptz;

create index if not exists contests_archived_at_idx
  on public.contests(archived_at);

create index if not exists contests_group_active_created_idx
  on public.contests(group_id, created_at)
  where archived_at is null;

create or replace function public.archive_contest_atomic(
  p_contest_id uuid,
  p_archived_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_archived_at timestamptz := now();
  v_deleted_transition_count int := 0;
  v_deleted_stage_count int := 0;
  v_deleted_match_count int := 0;
begin
  update public.contests
  set
    archived_at = coalesce(archived_at, v_archived_at),
    status = case
      when status in ('nominating', 'admin_nominating', 'waiting', 'voting')
        then 'closed'
      else status
    end,
    voting_ends_at = case
      when status = 'voting' and voting_ends_at is null then v_archived_at
      else voting_ends_at
    end,
    updated_at = now()
  where id = p_contest_id
  returning group_id, archived_at into v_group_id, v_archived_at;

  if not found then
    raise exception '活动不存在。';
  end if;

  delete from public.contest_scheduled_transitions
  where contest_id = p_contest_id
    and executed_at is null;
  get diagnostics v_deleted_transition_count = row_count;

  delete from public.tournament_matches
  where contest_id = p_contest_id;
  get diagnostics v_deleted_match_count = row_count;

  delete from public.tournament_stages
  where contest_id = p_contest_id;
  get diagnostics v_deleted_stage_count = row_count;

  return jsonb_build_object(
    'contestId', p_contest_id,
    'groupId', v_group_id,
    'archivedAt', v_archived_at,
    'archivedBy', p_archived_by,
    'deletedPendingTransitionCount', v_deleted_transition_count,
    'deletedTournamentStageCount', v_deleted_stage_count,
    'deletedTournamentMatchCount', v_deleted_match_count
  );
end;
$$;

create or replace function public.apply_due_scheduled_transitions(
  p_contest_id uuid default null
)
returns table (
  transition_id uuid,
  contest_id uuid,
  target_status text,
  run_at timestamptz,
  group_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  transition_record record;
  affected_group_id uuid;
begin
  for transition_record in
    select
      t.id,
      t.contest_id,
      t.target_status,
      t.run_at
    from public.contest_scheduled_transitions t
    join public.contests c on c.id = t.contest_id
    where t.executed_at is null
      and t.run_at <= now()
      and c.archived_at is null
      and (p_contest_id is null or t.contest_id = p_contest_id)
    order by t.run_at asc, t.created_at asc
    for update skip locked
  loop
    update public.contests c
    set
      status = transition_record.target_status,
      voting_starts_at = case
        when transition_record.target_status = 'voting' then transition_record.run_at
        else c.voting_starts_at
      end,
      voting_ends_at = case
        when transition_record.target_status = 'closed' then transition_record.run_at
        else c.voting_ends_at
      end
    where c.id = transition_record.contest_id
      and c.archived_at is null
    returning c.group_id into affected_group_id;

    if found then
      update public.contest_scheduled_transitions t
      set executed_at = now()
      where t.id = transition_record.id
        and t.executed_at is null;

      transition_id := transition_record.id;
      contest_id := transition_record.contest_id;
      target_status := transition_record.target_status;
      run_at := transition_record.run_at;
      group_id := affected_group_id;
      return next;
    end if;
  end loop;
end;
$$;

revoke all on function public.archive_contest_atomic(uuid, uuid)
from public, anon, authenticated;

grant execute on function public.archive_contest_atomic(uuid, uuid)
to service_role;

grant execute on function public.apply_due_scheduled_transitions(uuid)
to anon, authenticated;
