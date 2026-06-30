alter table public.tournament_draw_logs
  add column if not exists retracted_at timestamptz,
  add column if not exists retracted_by uuid references public.profiles(id) on delete set null,
  add column if not exists retract_reason text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tournament_draw_logs_retract_reason_length'
      and conrelid = 'public.tournament_draw_logs'::regclass
  ) then
    alter table public.tournament_draw_logs
      add constraint tournament_draw_logs_retract_reason_length
      check (
        retract_reason is null
        or char_length(retract_reason) between 1 and 500
      );
  end if;
end;
$$;

create index if not exists tournament_draw_logs_retracted_idx
  on public.tournament_draw_logs(tournament_id, retracted_at)
  where retracted_at is not null;

create or replace function public.retract_tournament_draw_atomic(
  p_tournament_id uuid,
  p_draw_log_id uuid,
  p_reason text,
  p_retracted_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_log record;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_now timestamptz := now();
  v_target_stage_ids uuid[] := array[]::uuid[];
  v_target_contest_ids uuid[] := array[]::uuid[];
  v_target_group_ids uuid[] := array[]::uuid[];
  v_source_contest_ids uuid[] := array[]::uuid[];
  v_stage_count int := 0;
  v_min_sequence int;
  v_deleted_transition_count int := 0;
  v_deleted_match_count int := 0;
  v_deleted_stage_count int := 0;
begin
  if char_length(v_reason) = 0 then
    raise exception '请填写撤回理由。';
  end if;

  if char_length(v_reason) > 500 then
    raise exception '撤回理由不能超过 500 个字符。';
  end if;

  select *
    into v_log
  from public.tournament_draw_logs
  where id = p_draw_log_id
    and tournament_id = p_tournament_id
  for update;

  if not found then
    raise exception '抽签日志不存在。';
  end if;

  if v_log.retracted_at is not null then
    raise exception '该抽签已经撤回。';
  end if;

  if v_log.kind not in (
    'preliminary_draw',
    'preliminary_tiebreaker_generation',
    'knockout_draw',
    'knockout_round_generation'
  ) then
    raise exception '该抽签类型不能撤回。';
  end if;

  if exists (
    select 1
    from public.tournament_draw_logs newer
    where newer.tournament_id = p_tournament_id
      and newer.retracted_at is null
      and (
        newer.created_at > v_log.created_at
        or (
          newer.created_at = v_log.created_at
          and newer.id::text > v_log.id::text
        )
      )
  ) then
    raise exception '只能撤回当前最新生成的赛程阶段。';
  end if;

  if jsonb_typeof(coalesce(v_log.output->'stageIds', '[]'::jsonb)) = 'array' then
    select coalesce(array_agg(value::uuid), array[]::uuid[])
      into v_target_stage_ids
    from jsonb_array_elements_text(coalesce(v_log.output->'stageIds', '[]'::jsonb))
      as stage_ids(value);
  end if;

  if coalesce(array_length(v_target_stage_ids, 1), 0) = 0 then
    if v_log.kind = 'preliminary_draw' then
      select coalesce(array_agg(s.id order by s.sequence), array[]::uuid[])
        into v_target_stage_ids
      from public.tournament_stages s
      join public.contests c on c.id = s.contest_id
      where s.tournament_id = p_tournament_id
        and s.kind = 'preliminary'
        and c.archived_at is null;
    elsif v_log.stage_id is not null then
      v_target_stage_ids := array[v_log.stage_id];
    end if;
  end if;

  select coalesce(array_agg(distinct stage_id), array[]::uuid[])
    into v_target_stage_ids
  from unnest(v_target_stage_ids) as target(stage_id);

  if coalesce(array_length(v_target_stage_ids, 1), 0) = 0 then
    raise exception '没有找到可撤回的赛程阶段。';
  end if;

  select
    count(*)::int,
    coalesce(array_agg(distinct s.contest_id) filter (where s.contest_id is not null), array[]::uuid[]),
    coalesce(array_agg(distinct s.group_id) filter (where s.group_id is not null), array[]::uuid[]),
    min(s.sequence)
    into
      v_stage_count,
      v_target_contest_ids,
      v_target_group_ids,
      v_min_sequence
  from public.tournament_stages s
  where s.tournament_id = p_tournament_id
    and s.id = any(v_target_stage_ids);

  if v_stage_count <> coalesce(array_length(v_target_stage_ids, 1), 0) then
    raise exception '撤回目标阶段不完整。';
  end if;

  if coalesce(array_length(v_target_contest_ids, 1), 0) = 0 then
    raise exception '撤回目标没有关联活动。';
  end if;

  if exists (
    select 1
    from public.contests c
    where c.id = any(v_target_contest_ids)
      and (c.archived_at is not null or c.status <> 'draft')
  ) then
    raise exception '目标阶段已经开始或已被归档，不能撤回。';
  end if;

  if exists (
    select 1
    from public.contest_scheduled_transitions t
    where t.contest_id = any(v_target_contest_ids)
      and t.executed_at is not null
  ) then
    raise exception '目标阶段已经执行过定时状态任务，不能撤回。';
  end if;

  if exists (
    select 1
    from public.tournament_stages s
    join public.contests c on c.id = s.contest_id
    where s.tournament_id = p_tournament_id
      and s.sequence < coalesce(v_min_sequence, 2147483647)
      and not (s.id = any(v_target_stage_ids))
      and c.archived_at is null
      and c.status not in ('closed', 'published')
  ) then
    raise exception '前置阶段尚未结束，不能撤回该抽签。';
  end if;

  select coalesce(array_agg(distinct c.id), array[]::uuid[])
    into v_source_contest_ids
  from public.tournament_stages s
  join public.contests c on c.id = s.contest_id
  where s.tournament_id = p_tournament_id
    and s.sequence < coalesce(v_min_sequence, 2147483647)
    and not (s.id = any(v_target_stage_ids))
    and c.archived_at is null;

  with target_candidates as (
    select c.id, c.inherited_from_candidate_id
    from public.candidates c
    where c.contest_id = any(v_target_contest_ids)
      and c.inherited_from_candidate_id is not null
  )
  update public.tournament_entries e
  set
    current_candidate_id = tc.inherited_from_candidate_id,
    source_candidate_id = case
      when v_log.kind = 'preliminary_draw' then tc.inherited_from_candidate_id
      else e.source_candidate_id
    end,
    preliminary_group = case
      when v_log.kind = 'preliminary_draw' then null
      else e.preliminary_group
    end,
    preliminary_rank = case
      when v_log.kind = 'preliminary_draw' then null
      else e.preliminary_rank
    end,
    is_group_winner = case
      when v_log.kind = 'preliminary_draw' then false
      else e.is_group_winner
    end,
    status = case
      when v_log.kind = 'preliminary_draw' then 'screening'
      when v_log.kind = 'preliminary_tiebreaker_generation' then 'preliminary'
      when v_log.kind = 'knockout_round_generation' then 'knockout'
      when v_log.kind = 'knockout_draw' and exists (
        select 1
        from public.candidates previous_candidate
        join public.tournament_stages previous_stage
          on previous_stage.contest_id = previous_candidate.contest_id
        where previous_candidate.id = tc.inherited_from_candidate_id
          and previous_stage.tournament_id = p_tournament_id
          and previous_stage.kind = 'tiebreaker'
      ) then 'tiebreaker'
      when v_log.kind = 'knockout_draw' then 'preliminary'
      else e.status
    end,
    updated_at = now()
  from target_candidates tc
  where e.tournament_id = p_tournament_id
    and e.current_candidate_id = tc.id;

  delete from public.contest_scheduled_transitions
  where contest_id = any(v_target_contest_ids)
    and executed_at is null;
  get diagnostics v_deleted_transition_count = row_count;

  update public.contests
  set
    archived_at = coalesce(archived_at, v_now),
    updated_at = now()
  where id = any(v_target_contest_ids);

  delete from public.tournament_matches
  where stage_id = any(v_target_stage_ids)
     or contest_id = any(v_target_contest_ids);
  get diagnostics v_deleted_match_count = row_count;

  delete from public.tournament_stages
  where id = any(v_target_stage_ids);
  get diagnostics v_deleted_stage_count = row_count;

  update public.tournament_draw_logs
  set
    retracted_at = v_now,
    retracted_by = p_retracted_by,
    retract_reason = v_reason
  where id = p_draw_log_id
    and retracted_at is null;

  if not found then
    raise exception '该抽签已经撤回。';
  end if;

  return jsonb_build_object(
    'drawLogId', p_draw_log_id,
    'tournamentId', p_tournament_id,
    'kind', v_log.kind,
    'archivedContestIds', to_jsonb(v_target_contest_ids),
    'groupIds', to_jsonb(v_target_group_ids),
    'sourceContestIds', to_jsonb(v_source_contest_ids),
    'retractedAt', v_now,
    'deletedPendingTransitionCount', v_deleted_transition_count,
    'deletedTournamentStageCount', v_deleted_stage_count,
    'deletedTournamentMatchCount', v_deleted_match_count
  );
end;
$$;

revoke all on function public.retract_tournament_draw_atomic(
  uuid,
  uuid,
  text,
  uuid
) from public, anon, authenticated;

grant execute on function public.retract_tournament_draw_atomic(
  uuid,
  uuid,
  text,
  uuid
) to service_role;
