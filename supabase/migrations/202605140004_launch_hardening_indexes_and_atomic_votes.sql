-- Launch hardening: query indexes, storage limit alignment, and atomic vote writes.

create unique index if not exists votes_contest_id_voter_id_key
  on public.votes(contest_id, voter_id);

create index if not exists nominations_contest_submitter_status_idx
  on public.nominations(contest_id, submitter_id, status);

create index if not exists contests_group_status_idx
  on public.contests(group_id, status);

create index if not exists contests_status_created_at_idx
  on public.contests(status, created_at desc);

create index if not exists contest_scheduled_transitions_executed_run_idx
  on public.contest_scheduled_transitions(executed_at, run_at);

create index if not exists love_vote_allocations_group_voter_idx
  on public.love_vote_allocations(group_id, voter_id);

create index if not exists love_vote_allocations_contest_candidate_idx
  on public.love_vote_allocations(contest_id, candidate_id);

create unique index if not exists qq_login_tickets_token_hash_key
  on public.qq_login_tickets(token_hash);

create unique index if not exists app_sessions_session_token_hash_key
  on public.app_sessions(session_token_hash);

update storage.buckets
set
  file_size_limit = 2097152,
  allowed_mime_types = array['image/webp', 'image/jpeg']
where id = 'vote-images';

create or replace function public.submit_vote_with_love(
  p_contest_id uuid,
  p_voter_id uuid,
  p_payload jsonb,
  p_love_candidate_ids uuid[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vote_id uuid;
  v_group_id uuid;
  v_love_vote_enabled boolean;
  v_love_vote_quota int;
  v_love_vote_weight numeric;
  v_existing_love_count int;
  v_love_candidate_ids uuid[] := coalesce(p_love_candidate_ids, array[]::uuid[]);
  v_new_love_count int := coalesce(array_length(coalesce(p_love_candidate_ids, array[]::uuid[]), 1), 0);
begin
  select c.group_id, c.love_vote_enabled, g.love_vote_quota, g.love_vote_weight
    into v_group_id, v_love_vote_enabled, v_love_vote_quota, v_love_vote_weight
  from public.contests c
  left join public.contest_groups g on g.id = c.group_id
  where c.id = p_contest_id;

  if not found then
    raise exception '活动不存在。';
  end if;

  if v_new_love_count > 0 then
    perform 1 from public.profiles where id = p_voter_id for update;

    if v_group_id is null or v_love_vote_enabled = false then
      raise exception '该活动不能使用真爱票。';
    end if;

    if coalesce(v_love_vote_quota, 0) <= 0 or coalesce(v_love_vote_weight, 0) <= 1 then
      raise exception '该活动不能使用真爱票。';
    end if;

    select count(*)::int
      into v_existing_love_count
    from public.love_vote_allocations
    where group_id = v_group_id
      and voter_id = p_voter_id;

    if v_existing_love_count + v_new_love_count > v_love_vote_quota then
      raise exception '你的真爱票额度不足，最多可使用 % 张。', v_love_vote_quota;
    end if;
  end if;

  insert into public.votes(contest_id, voter_id, payload)
  values (p_contest_id, p_voter_id, p_payload)
  returning id into v_vote_id;

  if v_new_love_count > 0 then
    insert into public.love_vote_allocations(
      group_id,
      contest_id,
      vote_id,
      candidate_id,
      voter_id
    )
    select
      v_group_id,
      p_contest_id,
      v_vote_id,
      candidate_id,
      p_voter_id
    from unnest(v_love_candidate_ids) as candidate_id;
  end if;

  return v_vote_id;
end;
$$;

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

    if not exists (
      select 1
      from public.contests
      where id = v_contest_id
        and group_id = p_group_id
    ) then
      raise exception '提交的活动必须属于当前活动组。';
    end if;

    select coalesce(array_agg(value::uuid), array[]::uuid[])
      into v_love_candidate_ids
    from jsonb_array_elements_text(
      coalesce(v_vote_item->'loveCandidateIds', '[]'::jsonb)
    ) as love_ids(value);

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

create or replace function public.review_nominations_atomic(
  p_nomination_ids uuid[],
  p_action text
)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected_count int;
  v_pending_count int;
  v_contest_ids uuid[];
begin
  if p_action not in ('approve', 'reject') then
    raise exception '审核操作无效。';
  end if;

  select count(*)::int
    into v_expected_count
  from unnest(coalesce(p_nomination_ids, array[]::uuid[])) as ids(id);

  if v_expected_count <= 0 then
    raise exception '请至少选择一条提名。';
  end if;

  perform 1
  from public.nominations
  where id = any(p_nomination_ids)
  for update;

  select count(*)::int, array_agg(distinct contest_id)
    into v_pending_count, v_contest_ids
  from public.nominations
  where id = any(p_nomination_ids)
    and status = 'pending';

  if v_pending_count <> v_expected_count then
    raise exception '只能审核待审核提名。';
  end if;

  if p_action = 'approve' then
    insert into public.candidates(
      contest_id,
      nomination_id,
      name,
      description,
      image_path,
      image_width,
      image_height,
      image_size,
      nominator_display_name
    )
    select
      contest_id,
      id,
      name,
      description,
      image_path,
      image_width,
      image_height,
      image_size,
      nominator_display_name
    from public.nominations
    where id = any(p_nomination_ids)
      and status = 'pending';

    update public.nominations
    set status = 'approved'
    where id = any(p_nomination_ids)
      and status = 'pending';
  else
    update public.nominations
    set status = 'rejected'
    where id = any(p_nomination_ids)
      and status = 'pending';
  end if;

  return coalesce(v_contest_ids, array[]::uuid[]);
end;
$$;

revoke all on function public.submit_vote_with_love(uuid, uuid, jsonb, uuid[]) from public, anon, authenticated;
revoke all on function public.submit_group_votes_with_love(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.review_nominations_atomic(uuid[], text) from public, anon, authenticated;

grant execute on function public.submit_vote_with_love(uuid, uuid, jsonb, uuid[]) to service_role;
grant execute on function public.submit_group_votes_with_love(uuid, uuid, jsonb) to service_role;
grant execute on function public.review_nominations_atomic(uuid[], text) to service_role;
