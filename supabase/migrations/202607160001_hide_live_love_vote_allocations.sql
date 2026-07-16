-- Live result visibility may expose aggregate scores, but it must never reveal
-- which votes used love allocations. Love-vote details are public only when
-- weighted love scores are public (published results), or through an explicit
-- admin override evaluated by get_contest_result_visibility.
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
   and visibility.show_weighted_love_score
  order by allocation.created_at asc;
$$;

revoke all on function public.get_visible_contest_love_vote_allocations(uuid[], boolean)
from public, anon, authenticated;

grant execute on function public.get_visible_contest_love_vote_allocations(uuid[], boolean)
to anon, authenticated;
