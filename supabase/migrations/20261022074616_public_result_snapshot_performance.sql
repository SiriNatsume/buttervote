-- Preaggregate vote points before candidate RLS checks, preserving visibility rules.
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
    select vote.*, contest.vote_type, coalesce(contest_group.love_vote_weight, 1) as love_vote_weight
    from public.get_visible_contest_vote_payloads(
      coalesce(p_contest_ids, array[]::uuid[]),
      p_include_admin_override
    ) as vote
    join public.contests as contest on contest.id = vote.contest_id
    left join public.contest_groups as contest_group on contest_group.id = contest.group_id
  ),
  expanded_points as (
    select
      vote.id as vote_id,
      vote.contest_id,
      vote.payload ->> 'candidateId' as candidate_id_text,
      1::double precision as points,
      vote.created_at, vote.love_vote_weight
    from visible_votes as vote
    where vote.vote_type = 'single'

    union all

    select
      vote.id,
      vote.contest_id,
      selected.candidate_id_text,
      1::double precision,
      vote.created_at, vote.love_vote_weight
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
      vote.created_at, vote.love_vote_weight
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
  visible_allocations as (
    select allocation.*
    from public.get_visible_contest_love_vote_allocations(
      coalesce(p_contest_ids, array[]::uuid[]), p_include_admin_override
    ) as allocation
  ),
  -- Collapse raw vote points before joining candidates and their RLS policy.
  -- Unknown/inactive IDs are discarded by the final candidate join, as before.
  point_totals as materialized (
    select point.contest_id, point.candidate_id_text,
      coalesce(sum(point.points) filter (where allocation.vote_id is null), 0)::double precision as normal_score,
      coalesce(sum(point.points * point.love_vote_weight) filter (where allocation.vote_id is not null), 0)::double precision as love_score,
      count(allocation.vote_id)::integer as love_vote_count,
      max(point.created_at) as last_vote_at
    from expanded_points as point
    left join visible_allocations as allocation
      on allocation.contest_id = point.contest_id and allocation.vote_id = point.vote_id
      and allocation.candidate_id::text = point.candidate_id_text
    group by point.contest_id, point.candidate_id_text
  ),
  candidate_scores as (
    select candidate.contest_id, candidate.id as candidate_id,
      coalesce(point.normal_score, 0)::double precision as normal_score,
      coalesce(point.love_score, 0)::double precision as love_score,
      coalesce(point.love_vote_count, 0)::integer as love_vote_count,
      point.last_vote_at
    from visibility
    join public.contests as contest on contest.id = visibility.contest_id
    join public.candidates as candidate on candidate.contest_id = contest.id
      and (candidate.is_active or (select include_inactive from caller))
    left join point_totals as point on point.contest_id = candidate.contest_id
      and point.candidate_id_text = candidate.id::text
  )
  select candidate_scores.contest_id, candidate_scores.candidate_id,
    candidate_scores.normal_score + candidate_scores.love_score as score,
    candidate_scores.normal_score, candidate_scores.love_score,
    candidate_scores.love_vote_count, candidate_scores.last_vote_at
  from candidate_scores;
$$;
revoke all on function public.get_visible_contest_tallies(uuid[], boolean) from public, anon, authenticated;
grant execute on function public.get_visible_contest_tallies(uuid[], boolean) to anon, authenticated;

-- Evaluate each ancestor contest's visibility once per candidate, rather than
-- once for every edge in the lineage. Keep the existing public/admin contract.
create or replace function public.can_read_candidate(p_candidate_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.is_admin() or coalesce((
    with recursive lineage as (
      select candidate.id, candidate.contest_id, candidate.inherited_from_candidate_id,
        array[candidate.id]::uuid[] as path, false as cycle_detected
      from public.candidates as candidate
      join public.contests as contest on contest.id = candidate.contest_id
      where candidate.id = p_candidate_id and candidate.is_active
        and contest.status <> 'draft' and contest.archived_at is null
      union all
      select source.id, source.contest_id, source.inherited_from_candidate_id,
        lineage.path || source.id, source.id = any(lineage.path)
      from lineage
      join public.candidates as source on source.id = lineage.inherited_from_candidate_id
      where not lineage.cycle_detected
    ),
    sources as materialized (
      select lineage.*, source.contest_id as source_contest_id
      from lineage left join public.candidates as source
        on source.id = lineage.inherited_from_candidate_id
    ),
    visibility as materialized (
      select * from public.get_contest_result_visibility(
        array(select distinct source_contest_id from sources where source_contest_id is not null), false
      )
    )
    select exists(select 1 from lineage) and not exists (
      select 1 from sources
      where cycle_detected or (inherited_from_candidate_id is not null and (
        source_contest_id is null or not exists (
          select 1 from visibility where contest_id = sources.source_contest_id and full_results_visible
        )
      ))
    )
  ), false);
$$;

-- Same policies, with statement-scoped identity lookups.
alter policy "Users can read own profile" on public.profiles using ((select auth.uid()) = id);
alter policy "Users can update own display name" on public.profiles
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
alter policy "Users can create own nominations" on public.nominations with check ((select auth.uid()) = submitter_id);
alter policy "Users can read own nominations" on public.nominations using ((select auth.uid()) = submitter_id);
alter policy "Users can update own pending nominations" on public.nominations
  using ((select auth.uid()) = submitter_id and status in ('pending', 'rejected'))
  with check ((select auth.uid()) = submitter_id and status in ('pending', 'rejected'));
alter policy "Users can create own votes" on public.votes with check ((select auth.uid()) = voter_id);
alter policy "Users can read own votes" on public.votes using ((select auth.uid()) = voter_id);
alter policy "Users can create own love votes" on public.love_vote_allocations with check ((select auth.uid()) = voter_id);
alter policy "Users can read own love votes" on public.love_vote_allocations using ((select auth.uid()) = voter_id);
alter policy "Users can read own user group memberships" on public.user_group_members using ((select auth.uid()) = profile_id);

-- Only published data is cacheable. Active voting never contends on this row.
create table public.public_result_cache_versions (
  contest_id uuid primary key references public.contests(id) on delete cascade,
  revision uuid not null default gen_random_uuid()
);
alter table public.public_result_cache_versions enable row level security;
revoke all on public.public_result_cache_versions from public, anon, authenticated;
grant select on public.public_result_cache_versions to anon, authenticated;
grant all on public.public_result_cache_versions to service_role;

create policy "Read currently public published result versions"
on public.public_result_cache_versions for select to anon, authenticated
using (contest_id in (
  select visibility.contest_id
  from public.get_contest_result_visibility(
    array(select id from public.contests where status = 'published' and archived_at is null), false
  ) as visibility where visibility.full_results_visible
));

insert into public.public_result_cache_versions(contest_id) select id from public.contests;

create or replace function buttervote_private.touch_public_result_cache()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  affected_ids uuid[];
begin
  if tg_table_name = 'contests' then
    affected_ids := array[new.id];
  elsif tg_table_name = 'contest_groups' then
    affected_ids := array(select id from public.contests where group_id = new.id);
  elsif tg_op = 'INSERT' then
    affected_ids := array[new.contest_id];
  elsif tg_op = 'DELETE' then
    affected_ids := array[old.contest_id];
  else
    affected_ids := array[old.contest_id, new.contest_id];
  end if;

  insert into public.public_result_cache_versions(contest_id, revision)
    select id, gen_random_uuid() from public.contests
    where id = any(affected_ids)
      and (status = 'published' or (tg_table_name = 'contests' and tg_op = 'INSERT'))
  on conflict(contest_id) do update set revision = excluded.revision;
  return null;
end;
$$;
revoke all on function buttervote_private.touch_public_result_cache() from public, anon, authenticated;

create trigger invalidate_public_result_contest after insert or update on public.contests
  for each row execute function buttervote_private.touch_public_result_cache();
create trigger invalidate_public_result_candidates after insert or update or delete on public.candidates
  for each row execute function buttervote_private.touch_public_result_cache();
create trigger invalidate_public_result_votes after insert or update or delete on public.votes
  for each row execute function buttervote_private.touch_public_result_cache();
create trigger invalidate_public_result_love_votes after insert or update or delete on public.love_vote_allocations
  for each row execute function buttervote_private.touch_public_result_cache();
create trigger invalidate_public_result_weights after update of love_vote_weight on public.contest_groups
  for each row execute function buttervote_private.touch_public_result_cache();

-- One MVCC snapshot authorizes the version and reads its public contents. A
-- concurrent edit/revocation omits the row, so callers cannot cache a partial or
-- unauthorized result under an old revision. No admin override or credentials.
create or replace function public.get_public_result_snapshots(p_contest_ids uuid[], p_revisions uuid[])
returns jsonb language sql stable security invoker set search_path = ''
as $$
  with requested as materialized (
    select * from unnest(p_contest_ids, p_revisions) as requested(contest_id, revision)
  ),
  eligible as materialized (
    select version.* from public.public_result_cache_versions as version
    join requested using (contest_id, revision)
    where cardinality(p_contest_ids) = cardinality(p_revisions)
      and cardinality(p_contest_ids) <= 100
  ),
  candidates as materialized (
    select candidate.id, candidate.contest_id, candidate.name, candidate.description,
      candidate.image_path, candidate.nominator_display_name, candidate.is_active, candidate.created_at
    from public.candidates as candidate
    where candidate.contest_id in (select contest_id from eligible) and candidate.is_active
  ),
  tallies as materialized (
    select * from public.get_visible_contest_tallies(array(select contest_id from eligible), false)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'contestId', eligible.contest_id, 'revision', eligible.revision,
    'candidates', (select coalesce(jsonb_agg(to_jsonb(candidate) order by candidate.created_at, candidate.id), '[]'::jsonb)
      from candidates as candidate where candidate.contest_id = eligible.contest_id),
    'tallies', (select coalesce(jsonb_agg(to_jsonb(tally) order by tally.candidate_id), '[]'::jsonb)
      from tallies as tally where tally.contest_id = eligible.contest_id)
  ) order by eligible.contest_id), '[]'::jsonb) from eligible;
$$;
revoke all on function public.get_public_result_snapshots(uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.get_public_result_snapshots(uuid[], uuid[]) to anon, authenticated;
