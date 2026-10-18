-- Extend visible aggregates to standalone contests and bound admin reads.
create or replace function public.get_visible_contest_tallies(
  p_contest_ids uuid[],
  p_include_admin_override boolean default false
)
returns table (
  contest_id uuid,
  candidate_id uuid,
  score double precision,
  normal_score double precision,
  love_score double precision,
  love_vote_count integer,
  last_vote_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with caller as (
    select coalesce(p_include_admin_override, false) and (
      (select public.is_admin())
      or coalesce((select auth.jwt() ->> 'role'), '') = 'service_role'
    ) as include_inactive
  ),
  visibility as (
    select visible.*
    from public.get_contest_result_visibility(
      coalesce(p_contest_ids, array[]::uuid[]),
      p_include_admin_override
    ) as visible
    where visible.full_results_visible
  ),
  visible_votes as (
    select vote.*, contest.vote_type
    from public.get_visible_contest_vote_payloads(
      coalesce(p_contest_ids, array[]::uuid[]),
      p_include_admin_override
    ) as vote
    join public.contests as contest on contest.id = vote.contest_id
  ),
  expanded_points as (
    select
      vote.id as vote_id,
      vote.contest_id,
      vote.payload ->> 'candidateId' as candidate_id_text,
      1::double precision as points,
      vote.created_at
    from visible_votes as vote
    where vote.vote_type = 'single'

    union all

    select
      vote.id,
      vote.contest_id,
      selected.candidate_id_text,
      1::double precision,
      vote.created_at
    from visible_votes as vote
    cross join lateral jsonb_array_elements_text(
      case
        when jsonb_typeof(vote.payload -> 'candidateIds') = 'array'
          then vote.payload -> 'candidateIds'
        else '[]'::jsonb
      end
    ) as selected(candidate_id_text)
    where vote.vote_type = 'multiple'

    union all

    select
      vote.id,
      vote.contest_id,
      ranked.candidate_id_text,
      (4 - ranked.ordinality)::double precision,
      vote.created_at
    from visible_votes as vote
    cross join lateral jsonb_array_elements_text(
      case
        when jsonb_typeof(vote.payload -> 'ranking') = 'array'
          then vote.payload -> 'ranking'
        else '[]'::jsonb
      end
    ) with ordinality as ranked(candidate_id_text, ordinality)
    where vote.vote_type = 'ranked'
      and ranked.ordinality <= 3
  ),
  eligible_points as (
    select
      point.vote_id,
      point.contest_id,
      candidate.id as candidate_id,
      point.points,
      point.created_at
    from expanded_points as point
    join public.candidates as candidate
      on candidate.contest_id = point.contest_id
     and candidate.id::text = point.candidate_id_text
     and (candidate.is_active or (select include_inactive from caller))
  ),
  visible_allocations as (
    select allocation.*
    from public.get_visible_contest_love_vote_allocations(
      coalesce(p_contest_ids, array[]::uuid[]),
      p_include_admin_override
    ) as allocation
  ),
  candidate_scores as (
    select
      candidate.contest_id,
      candidate.id as candidate_id,
      coalesce(
        sum(point.points) filter (where allocation.vote_id is null),
        0
      )::double precision as normal_score,
      coalesce(
        sum(point.points * coalesce(contest_group.love_vote_weight, 1))
          filter (where allocation.vote_id is not null),
        0
      )::double precision as love_score,
      count(allocation.vote_id)::integer as love_vote_count,
      max(point.created_at) as last_vote_at
    from visibility
    join public.contests as contest on contest.id = visibility.contest_id
    left join public.contest_groups as contest_group
      on contest_group.id = contest.group_id
    join public.candidates as candidate
      on candidate.contest_id = contest.id
     and (candidate.is_active or (select include_inactive from caller))
    left join eligible_points as point
      on point.contest_id = candidate.contest_id
     and point.candidate_id = candidate.id
    left join visible_allocations as allocation
      on allocation.contest_id = point.contest_id
     and allocation.vote_id = point.vote_id
     and allocation.candidate_id = point.candidate_id
    group by candidate.contest_id, candidate.id
  )
  select
    candidate_scores.contest_id,
    candidate_scores.candidate_id,
    candidate_scores.normal_score + candidate_scores.love_score as score,
    candidate_scores.normal_score,
    candidate_scores.love_score,
    candidate_scores.love_vote_count,
    candidate_scores.last_vote_at
  from candidate_scores;
$$;

revoke all on function public.get_visible_contest_tallies(uuid[], boolean)
from public, anon, authenticated;
grant execute on function public.get_visible_contest_tallies(uuid[], boolean)
to anon, authenticated;


-- These admin summaries retain RLS and explicitly verify the caller. The
-- service client is used only after the application's requireAdmin check.
create or replace function public.get_admin_user_group_member_stats()
returns table (user_group_id uuid, total bigint, active bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with caller as (
    select (select public.is_admin())
      or coalesce((select auth.jwt() ->> 'role'), '') = 'service_role' as allowed
  )
  select member.user_group_id, count(*) as total,
    count(*) filter (where member.revoked_at is null and member.expires_at > now()) as active
  from public.user_group_members as member
  cross join caller
  where caller.allowed
  group by member.user_group_id
  order by member.user_group_id;
$$;

revoke all on function public.get_admin_user_group_member_stats() from public, anon, authenticated;
grant execute on function public.get_admin_user_group_member_stats() to authenticated, service_role;

create or replace function public.get_admin_candidate_vote_usage(p_contest_id uuid)
returns table (candidate_id uuid)
language sql
stable
security invoker
set search_path = ''
as $$
  with caller as (
    select (select public.is_admin())
      or coalesce((select auth.jwt() ->> 'role'), '') = 'service_role' as allowed
  ),
  scoped_votes as materialized (
    select vote.payload
    from public.votes as vote
    cross join caller
    where caller.allowed and vote.contest_id = p_contest_id
  ),
  selected_ids as (
    select vote.payload ->> 'candidateId' as candidate_id_text
    from scoped_votes as vote
    union all
    select selected.candidate_id_text
    from scoped_votes as vote
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(vote.payload -> 'candidateIds') = 'array'
        then vote.payload -> 'candidateIds' else '[]'::jsonb end
    ) as selected(candidate_id_text)
    union all
    select ranked.candidate_id_text
    from scoped_votes as vote
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(vote.payload -> 'ranking') = 'array'
        then vote.payload -> 'ranking' else '[]'::jsonb end
    ) as ranked(candidate_id_text)
  )
  select distinct candidate.id
  from public.candidates as candidate
  join selected_ids on selected_ids.candidate_id_text = candidate.id::text
  where candidate.contest_id = p_contest_id
  order by candidate.id;
$$;

revoke all on function public.get_admin_candidate_vote_usage(uuid) from public, anon, authenticated;
grant execute on function public.get_admin_candidate_vote_usage(uuid) to authenticated, service_role;

create index if not exists nominations_pending_review_created_id_idx
  on public.nominations (created_at, id) where status = 'pending';

create index if not exists votes_contest_created_id_idx
  on public.votes (contest_id, created_at, id);

notify pgrst, 'reload schema';
