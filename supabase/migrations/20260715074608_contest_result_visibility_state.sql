create or replace function public.get_contest_result_visibility(
  p_contest_ids uuid[],
  p_include_admin_override boolean default false
)
returns table (
  contest_id uuid,
  visibility_state text,
  result_page_visible boolean,
  full_results_visible boolean,
  calling_progress_visible boolean,
  full_results_blocked_by_calling boolean,
  show_weighted_love_score boolean,
  reason text,
  calling_session_id uuid,
  calling_session_status text,
  visibility_version timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with recursive requested as (
    select distinct requested_id as contest_id
    from unnest(coalesce(p_contest_ids, array[]::uuid[])) as requested(requested_id)
    where requested_id is not null
  ),
  caller as (
    select coalesce(p_include_admin_override, false)
      and (
        public.is_admin()
        or coalesce(auth.role(), '') = 'service_role'
      ) as is_admin
  ),
  contest_dependencies as (
    select
      requested.contest_id as root_contest_id,
      source_candidate.id as source_candidate_id,
      source_candidate.contest_id as source_contest_id,
      array[requested.contest_id]::uuid[] || case
        when source_candidate.contest_id is null then array[]::uuid[]
        else array[source_candidate.contest_id]::uuid[]
      end as contest_path,
      coalesce(source_candidate.contest_id = requested.contest_id, false)
        as cycle_detected
    from requested
    join public.candidates as candidate
      on candidate.contest_id = requested.contest_id
     and candidate.is_active = true
    left join public.candidates as source_candidate
      on source_candidate.id = candidate.inherited_from_candidate_id
    where candidate.inherited_from_candidate_id is not null

    union

    select
      dependency.root_contest_id,
      next_source_candidate.id,
      next_source_candidate.contest_id,
      dependency.contest_path || case
        when next_source_candidate.contest_id is null then array[]::uuid[]
        else array[next_source_candidate.contest_id]::uuid[]
      end,
      coalesce(
        next_source_candidate.contest_id = any(dependency.contest_path),
        false
      )
    from contest_dependencies as dependency
    join public.candidates as candidate
      on candidate.contest_id = dependency.source_contest_id
     and candidate.is_active = true
    left join public.candidates as next_source_candidate
      on next_source_candidate.id = candidate.inherited_from_candidate_id
    where candidate.inherited_from_candidate_id is not null
      and not dependency.cycle_detected
  ),
  dependency_context as (
    select
      dependency.root_contest_id,
      dependency.cycle_detected,
      dependency.source_candidate_id,
      dependency.source_contest_id,
      source_contest.status as source_contest_status,
      source_contest.closed_result_visibility as source_closed_result_visibility,
      source_contest.live_results_enabled as source_live_results_enabled,
      source_contest.archived_at as source_archived_at,
      source_contest.updated_at as source_updated_at,
      source_calling.status::text as source_calling_status,
      source_calling.created_at as source_calling_created_at,
      source_calling.started_at as source_calling_started_at
    from contest_dependencies as dependency
    left join public.contests as source_contest
      on source_contest.id = dependency.source_contest_id
    left join lateral (
      select session.status, session.created_at, session.started_at
      from public.contest_calling_sessions as session
      where session.contest_id = source_contest.id
        and session.archived_at is null
        and session.status in ('active', 'paused', 'completed')
      order by session.created_at desc, session.id desc
      limit 1
    ) as source_calling on true
  ),
  dependency_summary as (
    select
      dependency.root_contest_id,
      bool_or(
        dependency.cycle_detected
        or dependency.source_candidate_id is null
        or dependency.source_contest_id is null
        or dependency.source_archived_at is not null
        or coalesce(
          dependency.source_calling_status in ('active', 'paused'),
          false
        )
        or not (
          dependency.source_contest_status = 'published'
          or (
            dependency.source_contest_status = 'closed'
            and dependency.source_closed_result_visibility = 'public'
          )
          or (
            dependency.source_contest_status = 'voting'
            and dependency.source_live_results_enabled = true
          )
        )
      ) as dependency_blocked,
      max(
        greatest(
          dependency.source_updated_at,
          dependency.source_calling_started_at,
          dependency.source_calling_created_at
        )
      ) as dependency_visibility_version
    from dependency_context as dependency
    group by dependency.root_contest_id
  ),
  context as (
    select
      requested.contest_id,
      contest.status as contest_status,
      contest.closed_result_visibility,
      contest.live_results_enabled,
      contest.archived_at,
      contest.updated_at as contest_updated_at,
      calling.id as calling_session_id,
      calling.status::text as calling_session_status,
      calling.created_at as calling_created_at,
      calling.started_at as calling_started_at,
      coalesce(not dependency.dependency_blocked, true) as dependencies_visible,
      dependency.dependency_visibility_version,
      caller.is_admin
    from requested
    cross join caller
    left join public.contests as contest
      on contest.id = requested.contest_id
    left join dependency_summary as dependency
      on dependency.root_contest_id = requested.contest_id
    left join lateral (
      select
        session.id,
        session.status,
        session.created_at,
        session.started_at
      from public.contest_calling_sessions as session
      where session.contest_id = contest.id
        and session.archived_at is null
        and session.status in ('active', 'paused', 'completed')
      order by session.created_at desc, session.id desc
      limit 1
    ) as calling on true
  ),
  resolved as (
    select
      context.*,
      case
        when context.contest_status is null or context.archived_at is not null
          then 'hidden'
        when context.is_admin
          then 'full'
        when not context.dependencies_visible
          then 'hidden'
        when context.calling_session_status in ('active', 'paused')
          and context.contest_status not in ('closed', 'published')
          then 'hidden'
        when context.calling_session_status in ('active', 'paused')
          then 'calling_progress'
        when context.contest_status = 'published'
          then 'full'
        when context.contest_status = 'closed'
          and context.closed_result_visibility = 'public'
          then 'full'
        when context.contest_status = 'voting'
          and context.live_results_enabled = true
          then 'full'
        else 'hidden'
      end as resolved_state,
      case
        when context.contest_status is null or context.archived_at is not null
          then 'hidden'
        when context.is_admin
          then 'admin'
        when not context.dependencies_visible
          then 'dependency_hidden'
        when context.calling_session_status in ('active', 'paused')
          and context.contest_status not in ('closed', 'published')
          then 'invalid_calling_state'
        when context.calling_session_status in ('active', 'paused')
          then 'calling_in_progress'
        when context.contest_status = 'published'
          then 'published'
        when context.contest_status = 'closed'
          and context.closed_result_visibility = 'public'
          then 'closed_public'
        when context.contest_status = 'voting'
          and context.live_results_enabled = true
          then 'live_results'
        else 'hidden'
      end as resolved_reason
    from context
  )
  select
    resolved.contest_id,
    resolved.resolved_state as visibility_state,
    resolved.resolved_state in ('calling_progress', 'full') as result_page_visible,
    resolved.resolved_state = 'full' as full_results_visible,
    resolved.resolved_state = 'calling_progress' as calling_progress_visible,
    not resolved.is_admin
      and coalesce(
        resolved.calling_session_status in ('active', 'paused'),
        false
      )
      as full_results_blocked_by_calling,
    resolved.resolved_state = 'full'
      and (resolved.is_admin or resolved.contest_status = 'published')
      as show_weighted_love_score,
    resolved.resolved_reason as reason,
    case
      when resolved.resolved_state <> 'hidden' then resolved.calling_session_id
      else null
    end as calling_session_id,
    case
      when resolved.resolved_state <> 'hidden' then resolved.calling_session_status
      else null
    end as calling_session_status,
    case
      when resolved.resolved_state = 'calling_progress'
        then greatest(
          resolved.contest_updated_at,
          resolved.calling_started_at,
          resolved.calling_created_at,
          resolved.dependency_visibility_version
        )
      when resolved.resolved_state = 'full'
        then greatest(
          resolved.contest_updated_at,
          resolved.dependency_visibility_version
        )
      else null
    end as visibility_version
  from resolved;
$$;

create or replace function public.can_view_contest_results(p_contest_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select visibility.full_results_visible
      from public.get_contest_result_visibility(array[p_contest_id], true) as visibility
      limit 1
    ),
    false
  );
$$;

create or replace function public.get_visible_contest_vote_payloads(
  p_contest_ids uuid[],
  p_include_admin_override boolean default false
)
returns table (
  id uuid,
  contest_id uuid,
  payload jsonb,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select vote.id, vote.contest_id, vote.payload, vote.created_at
  from public.votes as vote
  join public.get_contest_result_visibility(
    p_contest_ids,
    p_include_admin_override
  ) as visibility
    on visibility.contest_id = vote.contest_id
   and visibility.full_results_visible
  order by vote.created_at asc;
$$;

create or replace function public.get_visible_contest_love_vote_allocations(
  p_contest_ids uuid[],
  p_include_admin_override boolean default false
)
returns table (
  contest_id uuid,
  vote_id uuid,
  candidate_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select allocation.contest_id, allocation.vote_id, allocation.candidate_id
  from public.love_vote_allocations as allocation
  join public.get_contest_result_visibility(
    p_contest_ids,
    p_include_admin_override
  ) as visibility
    on visibility.contest_id = allocation.contest_id
   and visibility.full_results_visible
  order by allocation.created_at asc;
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
set search_path = ''
as $$
  select visible.id, visible.contest_id, visible.payload, visible.created_at
  from public.get_visible_contest_vote_payloads(array[p_contest_id], true) as visible;
$$;

create or replace function public.get_contest_love_vote_allocations(p_contest_id uuid)
returns table (
  vote_id uuid,
  candidate_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select visible.vote_id, visible.candidate_id
  from public.get_visible_contest_love_vote_allocations(
    array[p_contest_id],
    true
  ) as visible;
$$;

create or replace function public.complete_contest_calling_session(
  p_session_id uuid
)
returns table (
  contest_id uuid,
  session_status text,
  contest_status text,
  completed_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_contest_id uuid;
  v_total_steps integer;
  v_started_at timestamptz;
  v_contest_status text;
  v_now timestamptz := clock_timestamp();
begin
  select session.contest_id, session.total_steps, session.started_at
    into v_contest_id, v_total_steps, v_started_at
  from public.contest_calling_sessions as session
  where session.id = p_session_id
    and session.archived_at is null
    and session.status <> 'archived'
  for update;

  if not found then
    raise exception '唱票会话不存在或已归档。' using errcode = 'P0002';
  end if;

  select contest.status
    into v_contest_status
  from public.contests as contest
  where contest.id = v_contest_id
    and contest.archived_at is null
  for update;

  if not found then
    raise exception '活动不存在或已归档。' using errcode = 'P0002';
  end if;

  if v_contest_status not in ('closed', 'published') then
    raise exception '只有已结束或已发布的活动可以完成唱票。';
  end if;

  update public.contests as contest
  set status = 'published'
  where contest.id = v_contest_id;

  update public.contest_calling_sessions as session
  set
    status = 'completed',
    play_mode = 'manual',
    current_step = v_total_steps,
    started_at = coalesce(v_started_at, v_now),
    completed_at = v_now
  where session.id = p_session_id;

  return query
  select v_contest_id, 'completed'::text, 'published'::text, v_now;
end;
$$;

create or replace function public.publish_contest_when_calling_completed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'completed'
    and old.status is distinct from new.status
    and new.archived_at is null then
    new.current_step := new.total_steps;
    new.play_mode := 'manual';
    new.started_at := coalesce(new.started_at, clock_timestamp());
    new.completed_at := coalesce(new.completed_at, clock_timestamp());

    update public.contests as contest
    set status = 'published'
    where contest.id = new.contest_id
      and contest.archived_at is null
      and contest.status <> 'published';
  end if;

  return new;
end;
$$;

drop trigger if exists publish_contest_on_calling_completion
on public.contest_calling_sessions;
create trigger publish_contest_on_calling_completion
before update of status on public.contest_calling_sessions
for each row
execute function public.publish_contest_when_calling_completed();

-- A completed calling session now means the contest was explicitly published.
update public.contest_calling_sessions as session
set
  current_step = session.total_steps,
  play_mode = 'manual',
  started_at = coalesce(session.started_at, session.created_at),
  completed_at = coalesce(
    session.completed_at,
    session.updated_at,
    session.created_at
  )
where session.status = 'completed'
  and session.archived_at is null
  and (
    session.current_step is distinct from session.total_steps
    or session.play_mode is distinct from 'manual'
    or session.started_at is null
    or session.completed_at is null
  );

update public.contests as contest
set status = 'published'
where contest.archived_at is null
  and contest.status <> 'published'
  and exists (
    select 1
    from public.contest_calling_sessions as session
    where session.contest_id = contest.id
      and session.status = 'completed'
      and session.archived_at is null
  );

create or replace function public.can_read_candidate(p_candidate_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or coalesce(
    (
      with recursive candidate_lineage as (
        select
          candidate.id,
          candidate.inherited_from_candidate_id,
          array[candidate.id]::uuid[] as path,
          false as cycle_detected
        from public.candidates as candidate
        join public.contests as contest
          on contest.id = candidate.contest_id
        where candidate.id = p_candidate_id
          and candidate.is_active = true
          and contest.status <> 'draft'
          and contest.archived_at is null

        union all

        select
          source_candidate.id,
          source_candidate.inherited_from_candidate_id,
          lineage.path || source_candidate.id,
          source_candidate.id = any(lineage.path)
        from candidate_lineage as lineage
        join public.candidates as source_candidate
          on source_candidate.id = lineage.inherited_from_candidate_id
        where not lineage.cycle_detected
      )
      select
        exists (select 1 from candidate_lineage)
        and not exists (
          select 1
          from candidate_lineage as lineage
          left join public.candidates as source_candidate
            on source_candidate.id = lineage.inherited_from_candidate_id
          where lineage.cycle_detected
            or (
              lineage.inherited_from_candidate_id is not null
              and (
                source_candidate.id is null
                or not exists (
                  select 1
                  from public.get_contest_result_visibility(
                    array[source_candidate.contest_id],
                    false
                  ) as source_visibility
                  where source_visibility.full_results_visible
                )
              )
            )
        )
    ),
    false
  );
$$;

create or replace function public.get_visible_contest_nominations(
  p_contest_id uuid
)
returns table (
  id uuid,
  name text,
  description text,
  status text,
  nominator_display_name text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    nomination.id,
    nomination.name,
    nomination.description,
    nomination.status,
    nomination.nominator_display_name,
    nomination.created_at
  from public.nominations as nomination
  join public.contests as contest
    on contest.id = nomination.contest_id
  where nomination.contest_id = p_contest_id
    and nomination.status <> 'draft'
    and contest.status in ('nominating', 'admin_nominating', 'waiting')
    and contest.show_existing_nominations = true
    and contest.archived_at is null
    and not exists (
      select 1
      from public.candidates as candidate
      where candidate.nomination_id = nomination.id
        and not public.can_read_candidate(candidate.id)
    )
  order by nomination.created_at asc;
$$;

drop policy if exists "Anyone can read active candidates"
on public.candidates;
drop policy if exists "Anyone can read visible candidates"
on public.candidates;
create policy "Anyone can read visible candidates"
on public.candidates
for select
to anon, authenticated
using (public.can_read_candidate(id));

drop policy if exists "Anyone can read public calling sessions"
on public.contest_calling_sessions;
create policy "Anyone can read public calling sessions"
on public.contest_calling_sessions
for select
to anon, authenticated
using (
  archived_at is null
  and exists (
    select 1
    from public.get_contest_result_visibility(
      array[contest_calling_sessions.contest_id],
      false
    ) as visibility
    where visibility.calling_session_id = contest_calling_sessions.id
      and (
        (
          contest_calling_sessions.status in ('active', 'paused')
          and visibility.calling_progress_visible
        )
        or (
          contest_calling_sessions.status = 'completed'
          and visibility.full_results_visible
        )
      )
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
    from public.contest_calling_sessions as session
    join public.get_contest_result_visibility(
      array[session.contest_id],
      false
    ) as visibility
      on visibility.calling_session_id = session.id
    where session.id = contest_calling_events.session_id
      and session.archived_at is null
      and (
        (
          session.status = 'completed'
          and visibility.full_results_visible
        )
        or (
          session.status in ('active', 'paused')
          and visibility.calling_progress_visible
          and contest_calling_events.sequence <= session.current_step
        )
      )
  )
);

drop policy if exists "Anyone can read tournament entries"
on public.tournament_entries;
drop policy if exists "Anyone can read tournament matches"
on public.tournament_matches;
drop policy if exists "Anyone can read tournament draw logs"
on public.tournament_draw_logs;

revoke select on public.tournament_entries from public, anon;
revoke select on public.tournament_matches from public, anon;
revoke select on public.tournament_draw_logs from public, anon;

revoke all on function public.get_contest_result_visibility(uuid[], boolean)
from public, anon, authenticated;
revoke all on function public.can_view_contest_results(uuid)
from public, anon, authenticated;
revoke all on function public.get_visible_contest_vote_payloads(uuid[], boolean)
from public, anon, authenticated;
revoke all on function public.get_visible_contest_love_vote_allocations(uuid[], boolean)
from public, anon, authenticated;
revoke all on function public.get_contest_vote_payloads(uuid)
from public, anon, authenticated;
revoke all on function public.get_contest_love_vote_allocations(uuid)
from public, anon, authenticated;
revoke all on function public.can_read_candidate(uuid)
from public, anon, authenticated;
revoke all on function public.get_visible_contest_nominations(uuid)
from public, anon, authenticated;
revoke all on function public.complete_contest_calling_session(uuid)
from public, anon, authenticated;
revoke all on function public.publish_contest_when_calling_completed()
from public, anon, authenticated;

grant execute on function public.get_contest_result_visibility(uuid[], boolean)
to anon, authenticated;
grant execute on function public.can_view_contest_results(uuid)
to anon, authenticated;
grant execute on function public.get_visible_contest_vote_payloads(uuid[], boolean)
to anon, authenticated;
grant execute on function public.get_visible_contest_love_vote_allocations(uuid[], boolean)
to anon, authenticated;
grant execute on function public.get_contest_vote_payloads(uuid)
to anon, authenticated;
grant execute on function public.get_contest_love_vote_allocations(uuid)
to anon, authenticated;
grant execute on function public.can_read_candidate(uuid)
to anon, authenticated;
grant execute on function public.get_visible_contest_nominations(uuid)
to anon, authenticated;
grant execute on function public.complete_contest_calling_session(uuid)
to service_role;
