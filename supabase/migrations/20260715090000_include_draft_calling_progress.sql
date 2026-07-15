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
        and session.status in ('draft', 'active', 'paused', 'completed')
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
          dependency.source_calling_status in ('draft', 'active', 'paused'),
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
        and session.status in ('draft', 'active', 'paused', 'completed')
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
        when context.calling_session_status in ('draft', 'active', 'paused')
          and context.contest_status not in ('closed', 'published')
          then 'hidden'
        when context.calling_session_status in ('draft', 'active', 'paused')
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
        when context.calling_session_status in ('draft', 'active', 'paused')
          and context.contest_status not in ('closed', 'published')
          then 'invalid_calling_state'
        when context.calling_session_status = 'draft'
          then 'calling_ready'
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
        resolved.calling_session_status in ('draft', 'active', 'paused'),
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
          contest_calling_sessions.status in ('draft', 'active', 'paused')
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
          session.status in ('draft', 'active', 'paused')
          and visibility.calling_progress_visible
          and contest_calling_events.sequence <= session.current_step
        )
      )
  )
);
