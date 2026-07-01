create or replace function public.supplement_love_votes(
  p_group_id uuid,
  p_voter_id uuid,
  p_requests jsonb
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requests jsonb := coalesce(p_requests, '[]'::jsonb);
  v_request jsonb;
  v_contest_id uuid;
  v_vote_id uuid;
  v_vote_payload jsonb;
  v_vote_type text;
  v_love_candidate_ids uuid[] := array[]::uuid[];
  v_selected_candidate_ids uuid[] := array[]::uuid[];
  v_existing_love_count int := 0;
  v_new_love_count int := 0;
  v_current_love_count int := 0;
  v_inserted_count int := 0;
  v_love_vote_quota int;
  v_love_vote_weight numeric;
begin
  if jsonb_typeof(v_requests) is distinct from 'array'
    or jsonb_array_length(v_requests) = 0 then
    raise exception '真爱票补投数据无效。';
  end if;

  select love_vote_quota, love_vote_weight
    into v_love_vote_quota, v_love_vote_weight
  from public.contest_groups
  where id = p_group_id;

  if not found then
    raise exception '活动组不存在。';
  end if;

  if coalesce(v_love_vote_quota, 0) <= 0
    or coalesce(v_love_vote_weight, 0) <= 1 then
    raise exception '该活动组不能使用真爱票。';
  end if;

  perform 1 from public.profiles where id = p_voter_id for update;
  if not found then
    raise exception '投票用户不存在。';
  end if;

  select count(*)::int
    into v_existing_love_count
  from public.love_vote_allocations
  where group_id = p_group_id
    and voter_id = p_voter_id;

  for v_request in
    select value from jsonb_array_elements(v_requests) as items(value)
  loop
    if jsonb_typeof(v_request) is distinct from 'object' then
      raise exception '真爱票补投数据无效。';
    end if;

    v_contest_id := (v_request->>'contestId')::uuid;

    select coalesce(array_agg(distinct value::uuid), array[]::uuid[])
      into v_love_candidate_ids
    from jsonb_array_elements_text(
      coalesce(v_request->'candidateIds', '[]'::jsonb)
    ) as candidate_ids(value);

    v_current_love_count := coalesce(array_length(v_love_candidate_ids, 1), 0);

    if v_contest_id is null or v_current_love_count = 0 then
      raise exception '请选择要补投真爱票的候选项。';
    end if;

    select
      c.vote_type,
      v.id,
      v.payload
      into
        v_vote_type,
        v_vote_id,
        v_vote_payload
    from public.contests c
    join public.votes v
      on v.contest_id = c.id
      and v.voter_id = p_voter_id
    where c.id = v_contest_id
      and c.group_id = p_group_id
      and c.status = 'voting'
      and c.love_vote_enabled = true
      and c.archived_at is null
    for update of c, v;

    if not found then
      raise exception '只能为已投票且正在投票的活动补投真爱票。';
    end if;

    if v_vote_type = 'single' then
      if v_vote_payload->>'candidateId' is null then
        raise exception '原投票数据无效，不能补投真爱票。';
      end if;
      v_selected_candidate_ids := array[(v_vote_payload->>'candidateId')::uuid];
    elsif v_vote_type = 'multiple' then
      select coalesce(array_agg(distinct value::uuid), array[]::uuid[])
        into v_selected_candidate_ids
      from jsonb_array_elements_text(
        coalesce(v_vote_payload->'candidateIds', '[]'::jsonb)
      ) as selected_ids(value);
    elsif v_vote_type = 'ranked' then
      select coalesce(array_agg(distinct value::uuid), array[]::uuid[])
        into v_selected_candidate_ids
      from jsonb_array_elements_text(
        coalesce(v_vote_payload->'ranking', '[]'::jsonb)
      ) as selected_ids(value);
    else
      raise exception '投票类型无效。';
    end if;

    if coalesce(array_length(v_selected_candidate_ids, 1), 0) = 0 then
      raise exception '原投票数据无效，不能补投真爱票。';
    end if;

    if exists (
      select 1
      from unnest(v_love_candidate_ids) as love(candidate_id)
      left join unnest(v_selected_candidate_ids) as selected(candidate_id)
        on selected.candidate_id = love.candidate_id
      where selected.candidate_id is null
    ) then
      raise exception '真爱票只能补投给你已选择的候选项。';
    end if;

    if exists (
      select 1
      from unnest(v_love_candidate_ids) as love(candidate_id)
      left join public.candidates c
        on c.id = love.candidate_id
        and c.contest_id = v_contest_id
        and c.is_active = true
      where c.id is null
    ) then
      raise exception '真爱票候选项不属于当前活动。';
    end if;

    if exists (
      select 1
      from unnest(v_love_candidate_ids) as love(candidate_id)
      join public.love_vote_allocations l
        on l.vote_id = v_vote_id
        and l.candidate_id = love.candidate_id
    ) then
      raise exception '你已经给其中一个候选项使用过真爱票。';
    end if;

    v_new_love_count := v_new_love_count + v_current_love_count;

    if v_existing_love_count + v_new_love_count > v_love_vote_quota then
      raise exception '你的真爱票额度不足，最多可使用 % 张。', v_love_vote_quota;
    end if;

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
    from unnest(v_love_candidate_ids) as love_ids(candidate_id);

    v_inserted_count := v_inserted_count + v_current_love_count;
  end loop;

  return v_inserted_count;
end;
$$;

revoke all on function public.supplement_love_votes(uuid, uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.supplement_love_votes(uuid, uuid, jsonb)
to service_role;