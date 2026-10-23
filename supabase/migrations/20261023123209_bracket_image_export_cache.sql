-- Server-only, read-only, one-MVCC-snapshot export state. The HTTP handler must
-- separately authorize its caller's group read. No admin visibility override.
create or replace function public.get_bracket_image_export_state(
  p_group_id uuid,
  p_tournament_id uuid default null,
  p_include_snapshot boolean default false,
  p_expected_revision text default null
)
returns jsonb language sql stable security invoker set search_path = ''
as $$
  with recursive
  target_group as materialized (
    select * from public.contest_groups where id = p_group_id
  ),
  target as materialized (
    select tournament.* from public.tournaments as tournament
    where tournament.status <> 'archived' and exists (
      select 1 from public.tournament_matches as match
      join public.contests as contest on contest.id = match.contest_id
      where match.tournament_id = tournament.id and contest.group_id = p_group_id
        and contest.archived_at is null
    ) and exists (select 1 from target_group)
    order by (tournament.id = p_tournament_id) desc nulls last, tournament.updated_at desc, tournament.id
    limit 1
  ),
  matches as materialized (
    select match.* from public.tournament_matches as match
    where match.tournament_id = (select id from target) and match.contest_id is not null
      and match.round in ('round_of_16', 'quarterfinal', 'semifinal', 'final', 'third_place')
  ),
  export_contests as materialized (
    select contest.* from public.contests as contest
    where contest.id in (select contest_id from matches) and contest.group_id = p_group_id
      and contest.status <> 'draft' and contest.archived_at is null
  ),
  active_matches as materialized (
    select * from matches where contest_id in (select id from export_contests)
  ),
  entries as materialized (
    select entry.* from public.tournament_entries as entry where entry.id in (
      select unnest(array[left_entry_id, right_entry_id, winner_entry_id, loser_entry_id]) from active_matches
    )
  ),
  seed_ids as (
    select unnest(array[root_candidate_id, current_candidate_id, source_candidate_id]) as id from entries
    union select candidate.id from public.candidates as candidate
      where candidate.contest_id in (select id from export_contests) and candidate.is_active
  ),
  lineage as (
    select candidate.* from public.candidates as candidate
      where candidate.id in (select id from seed_ids) and candidate.is_active
    union
    select source.* from public.candidates as source
      join lineage on source.id = lineage.inherited_from_candidate_id where source.is_active
  ),
  requested_ids as materialized (
    select contest_id as id from matches union select contest_id from lineage
  ),
  relevant_contests as materialized (
    select * from public.contests where id in (select id from requested_ids)
  ),
  visibility as materialized (
    select * from public.get_contest_result_visibility(array(select id from requested_ids), false)
  ),
  result_versions as materialized (
    select * from public.public_result_cache_versions where contest_id in (select id from requested_ids)
  ),
  image_paths as materialized (
    select distinct image_path as path from lineage where image_path is not null and image_path <> ''
  ),
  assets as materialized (
    select image_paths.path,
      case when object.id is null then null else
        pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(jsonb_build_array(
          object.id, object.version, object.updated_at, object.metadata
        )::text, 'UTF8')), 'hex') end as revision
    from image_paths left join storage.objects as object
      on object.bucket_id = 'vote-images' and object.name = image_paths.path
  ),
  material as (
    select jsonb_build_object(
      'protocol', 1, 'tournament', (select to_jsonb(target) from target),
      'group', (select to_jsonb(target_group) from target_group),
      'matches', (select coalesce(jsonb_agg(to_jsonb(matches) order by id), '[]') from matches),
      'contests', (select coalesce(jsonb_agg(to_jsonb(relevant_contests) order by id), '[]') from relevant_contests),
      'entries', (select coalesce(jsonb_agg(to_jsonb(entries) order by id), '[]') from entries),
      'candidates', (select coalesce(jsonb_agg(to_jsonb(lineage) order by id), '[]') from lineage),
      'visibility', (select coalesce(jsonb_agg(to_jsonb(visibility) order by contest_id), '[]') from visibility),
      'results', (select coalesce(jsonb_agg(to_jsonb(result_versions) order by contest_id), '[]') from result_versions),
      'assets', (select coalesce(jsonb_agg(to_jsonb(assets) order by path), '[]') from assets)
    ) as value
  ),
  state as (
    select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(material.value::text, 'UTF8')), 'hex') as revision,
      exists (select 1 from active_matches)
      and not exists (select 1 from relevant_contests where status <> 'published' or archived_at is not null)
      and not exists (select 1 from visibility where not full_results_visible or not show_weighted_love_score)
      and (select count(*) from visibility) = (select count(*) from requested_ids)
      and (select count(*) from result_versions) = (select count(*) from requested_ids)
      and not exists (select 1 from assets where revision is null) as cacheable
    from material
  )
  select jsonb_build_object(
    'groupId', p_group_id, 'groupName', (select name from target_group),
    'tournamentId', target.id, 'revision', state.revision, 'cacheable', state.cacheable,
    'visibilityVersion', (floor(extract(epoch from greatest(target.updated_at,
      (select max(updated_at) from active_matches), (select max(visibility_version) from visibility))) * 1000)::bigint)::text,
    'assets', (select coalesce(jsonb_object_agg(path, revision), '{}') from assets),
    'snapshot', case when p_include_snapshot and (p_expected_revision is null or state.revision = p_expected_revision)
      then jsonb_build_object(
        'tournament', to_jsonb(target), 'loveVoteWeight', (select love_vote_weight from target_group),
        'matches', (select coalesce(jsonb_agg(to_jsonb(matches) order by id), '[]') from matches),
        'contests', (select coalesce(jsonb_agg(to_jsonb(export_contests) order by id), '[]') from export_contests),
        'entries', (select coalesce(jsonb_agg(to_jsonb(entries) order by id), '[]') from entries),
        'candidates', (select coalesce(jsonb_agg(to_jsonb(lineage) order by id), '[]') from lineage),
        'visibility', (select coalesce(jsonb_agg(to_jsonb(visibility) order by contest_id), '[]') from visibility),
        'tallies', (select coalesce(jsonb_agg(to_jsonb(tally) order by contest_id, candidate_id), '[]')
          from public.get_visible_contest_tallies(array(
            select export_contests.id from export_contests join visibility on visibility.contest_id = export_contests.id
            where visibility.full_results_visible
          ), false) as tally)
      ) else null end
  ) from target cross join state;
$$;
revoke all on function public.get_bracket_image_export_state(uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.get_bracket_image_export_state(uuid, uuid, boolean, text) to service_role;
notify pgrst, 'reload schema';
