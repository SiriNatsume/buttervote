alter table public.contest_scheduled_transitions
  drop constraint if exists contest_scheduled_transitions_target_status_check;

alter table public.contest_scheduled_transitions
  add constraint contest_scheduled_transitions_target_status_check
  check (
    target_status in (
      'draft',
      'nominating',
      'admin_nominating',
      'waiting',
      'voting',
      'closed',
      'published'
    )
  );

create or replace function public.submit_group_votes_with_love(
  p_group_id uuid,
  p_voter_id uuid,
  p_votes jsonb
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_votes jsonb := coalesce(p_votes, '[]'::jsonb);
  v_vote_item jsonb;
  v_contest_id uuid;
  v_payload jsonb;
  v_vote_id uuid;
  v_love_candidate_ids uuid[];
  v_inserted_count int := 0;
  v_existing_love_count int := 0;
  v_new_love_count int := 0;
  v_love_vote_quota int;
  v_love_vote_weight numeric;
  v_love_vote_enabled boolean;
begin
  if jsonb_typeof(v_votes) <> 'array' or jsonb_array_length(v_votes) = 0 then
    raise exception '组内投票数据无效。';
  end if;

  select love_vote_quota, love_vote_weight
    into v_love_vote_quota, v_love_vote_weight
  from public.contest_groups
  where id = p_group_id;

  if not found then
    raise exception '活动组不存在。';
  end if;

  perform 1 from public.profiles where id = p_voter_id for update;

  select coalesce(
    sum(
      case
        when jsonb_typeof(value->'loveCandidateIds') = 'array'
          then jsonb_array_length(value->'loveCandidateIds')
        else 0
      end
    ),
    0
  )::int
    into v_new_love_count
  from jsonb_array_elements(v_votes) as items(value);

  if v_new_love_count > 0 then
    if coalesce(v_love_vote_quota, 0) <= 0 or coalesce(v_love_vote_weight, 0) <= 1 then
      raise exception '该活动组不能使用真爱票。';
    end if;

    select count(*)::int
      into v_existing_love_count
    from public.love_vote_allocations
    where group_id = p_group_id
      and voter_id = p_voter_id;

    if v_existing_love_count + v_new_love_count > v_love_vote_quota then
      raise exception '该活动组最多可使用 % 张真爱票。', v_love_vote_quota;
    end if;
  end if;

  for v_vote_item in
    select value from jsonb_array_elements(v_votes) as items(value)
  loop
    v_contest_id := (v_vote_item->>'contestId')::uuid;
    v_payload := v_vote_item->'payload';

    if v_contest_id is null or v_payload is null then
      raise exception '组内投票数据无效。';
    end if;

    select c.love_vote_enabled
      into v_love_vote_enabled
    from public.contests c
    where c.id = v_contest_id
      and c.group_id = p_group_id;

    if not found then
      raise exception '提交的活动必须属于当前活动组。';
    end if;

    select coalesce(array_agg(value::uuid), array[]::uuid[])
      into v_love_candidate_ids
    from jsonb_array_elements_text(
      coalesce(v_vote_item->'loveCandidateIds', '[]'::jsonb)
    ) as love_ids(value);

    if coalesce(array_length(v_love_candidate_ids, 1), 0) > 0
      and v_love_vote_enabled = false then
      raise exception '该活动不可使用真爱票。';
    end if;

    insert into public.votes(contest_id, voter_id, payload)
    values (v_contest_id, p_voter_id, v_payload)
    returning id into v_vote_id;

    if coalesce(array_length(v_love_candidate_ids, 1), 0) > 0 then
      insert into public.love_vote_allocations(
        group_id,
        contest_id,
        vote_id,
        candidate_id,
        voter_id
      )
      select
        p_group_id,
        v_contest_id,
        v_vote_id,
        candidate_id,
        p_voter_id
      from unnest(v_love_candidate_ids) as candidate_id;
    end if;

    v_inserted_count := v_inserted_count + 1;
  end loop;

  return v_inserted_count;
end;
$$;

drop function if exists public.inherit_candidates_atomic(uuid, uuid[]);

create or replace function public.inherit_candidates_atomic(
  p_target_contest_id uuid,
  p_source_contest_id uuid,
  p_source_candidate_ids uuid[]
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_group_id uuid;
  v_source_group_id uuid;
  v_expected_count int := 0;
  v_found_count int := 0;
  v_candidate record;
  v_nomination_id uuid;
  v_inherited_count int := 0;
begin
  select group_id
    into v_target_group_id
  from public.contests
  where id = p_target_contest_id;

  if not found or v_target_group_id is null then
    raise exception '目标活动不存在或不属于活动组。';
  end if;

  select group_id
    into v_source_group_id
  from public.contests
  where id = p_source_contest_id;

  if not found or v_source_group_id is null then
    raise exception '来源活动不存在或不属于活动组。';
  end if;

  if v_source_group_id is distinct from v_target_group_id then
    raise exception '来源活动和目标活动必须属于同一个活动组。';
  end if;

  select count(distinct id)::int
    into v_expected_count
  from unnest(coalesce(p_source_candidate_ids, array[]::uuid[])) as ids(id);

  if v_expected_count = 0 then
    return 0;
  end if;

  select count(*)::int
    into v_found_count
  from public.candidates c
  where c.id in (
    select distinct id
    from unnest(coalesce(p_source_candidate_ids, array[]::uuid[])) as ids(id)
  )
    and c.contest_id = p_source_contest_id
    and c.is_active = true;

  if v_found_count <> v_expected_count then
    raise exception '包含不存在或不可继承的来源候选项。';
  end if;

  for v_candidate in
    select
      c.id,
      c.name,
      c.description,
      c.image_path,
      c.image_width,
      c.image_height,
      c.image_size,
      c.nominator_display_name,
      c.nominator_note
    from public.candidates c
    where c.id = any(p_source_candidate_ids)
      and c.contest_id = p_source_contest_id
      and c.is_active = true
    order by c.created_at asc, c.id asc
  loop
    if exists (
      select 1
      from public.candidates existing
      where existing.contest_id = p_target_contest_id
        and existing.inherited_from_candidate_id = v_candidate.id
    ) then
      continue;
    end if;

    insert into public.nominations (
      contest_id,
      submitter_id,
      name,
      description,
      status,
      image_path,
      image_width,
      image_height,
      image_size,
      nominator_display_name,
      nominator_note
    )
    values (
      p_target_contest_id,
      null,
      v_candidate.name,
      v_candidate.description,
      'approved',
      v_candidate.image_path,
      v_candidate.image_width,
      v_candidate.image_height,
      v_candidate.image_size,
      v_candidate.nominator_display_name,
      v_candidate.nominator_note
    )
    returning id into v_nomination_id;

    insert into public.candidates(
      contest_id,
      nomination_id,
      name,
      description,
      image_path,
      image_width,
      image_height,
      image_size,
      nominator_display_name,
      nominator_note,
      inherited_from_candidate_id
    )
    values (
      p_target_contest_id,
      v_nomination_id,
      v_candidate.name,
      v_candidate.description,
      v_candidate.image_path,
      v_candidate.image_width,
      v_candidate.image_height,
      v_candidate.image_size,
      v_candidate.nominator_display_name,
      v_candidate.nominator_note,
      v_candidate.id
    );

    v_inherited_count := v_inherited_count + 1;
  end loop;

  return v_inherited_count;
end;
$$;

create or replace function public.update_contest_group_access_atomic(
  p_group_id uuid,
  p_access_mode text,
  p_allowed_user_group_ids uuid[] default array[]::uuid[]
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected_count int := 0;
  v_existing_count int := 0;
begin
  if p_access_mode not in ('public', 'restricted') then
    raise exception '参与权限设置无效。';
  end if;

  perform 1
  from public.contest_groups
  where id = p_group_id
  for update;

  if not found then
    raise exception '活动组不存在。';
  end if;

  select count(distinct id)::int
    into v_expected_count
  from unnest(coalesce(p_allowed_user_group_ids, array[]::uuid[])) as ids(id);

  if v_expected_count > 0 then
    select count(*)::int
      into v_existing_count
    from public.user_groups
    where id in (
      select distinct id
      from unnest(coalesce(p_allowed_user_group_ids, array[]::uuid[])) as ids(id)
    );

    if v_existing_count <> v_expected_count then
      raise exception '包含不存在的用户组。';
    end if;
  end if;

  update public.contest_groups
  set access_mode = p_access_mode
  where id = p_group_id;

  delete from public.contest_group_allowed_user_groups
  where contest_group_id = p_group_id;

  if v_expected_count > 0 then
    insert into public.contest_group_allowed_user_groups(
      contest_group_id,
      user_group_id
    )
    select p_group_id, ids.id
    from (
      select distinct id
      from unnest(coalesce(p_allowed_user_group_ids, array[]::uuid[])) as distinct_ids(id)
    ) as ids
    on conflict (contest_group_id, user_group_id) do nothing;
  end if;

  return true;
end;
$$;

revoke all on function public.submit_group_votes_with_love(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.inherit_candidates_atomic(uuid, uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.update_contest_group_access_atomic(uuid, text, uuid[]) from public, anon, authenticated;

grant execute on function public.submit_group_votes_with_love(uuid, uuid, jsonb) to service_role;
grant execute on function public.inherit_candidates_atomic(uuid, uuid, uuid[]) to service_role;
grant execute on function public.update_contest_group_access_atomic(uuid, text, uuid[]) to service_role;
