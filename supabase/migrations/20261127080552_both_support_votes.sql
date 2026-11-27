-- A both-support ballot remains one vote; only its two base-point contributions differ.
alter table public.contests
  add column both_support_enabled boolean not null default true;

-- Use authoritative candidate/access data even when candidate RLS hides a row.
-- This private trigger is not an exposed RPC and applies to direct inserts too.
create or replace function buttervote_private.validate_both_support_vote()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contest public.contests%rowtype;
  v_selected uuid[];
  v_candidates uuid[];
begin
  if new.payload ? 'ballotType' and new.payload->>'ballotType' is distinct from 'both_support' then
    raise exception '选票类型无效。';
  end if;
  if new.payload->>'ballotType' is distinct from 'both_support' then return new; end if;

  select * into v_contest from public.contests where id = new.contest_id for update;
  if not found or v_contest.vote_type <> 'single' or not v_contest.both_support_enabled
    or v_contest.status <> 'voting' or v_contest.archived_at is not null
    or v_contest.voting_starts_at > now() or v_contest.voting_ends_at <= now() then
    raise exception '该活动当前不能同时支持两项，请刷新后重新选择。';
  end if;
  if new.voter_id is null then raise exception '投票用户不存在。'; end if;
  if exists (select 1 from public.contest_groups g where g.id = v_contest.group_id and g.access_mode = 'restricted')
    and not exists (select 1 from public.profiles p where p.id = new.voter_id and p.role = 'admin')
    and not exists (
      select 1 from public.contest_group_allowed_user_groups allowed
      join public.user_group_members member on member.user_group_id = allowed.user_group_id
      where allowed.contest_group_id = v_contest.group_id and member.profile_id = new.voter_id
        and member.revoked_at is null and member.expires_at > now()
    ) then
    raise exception '你暂时没有参与该活动组投票的权限。';
  end if;
  if jsonb_typeof(new.payload->'candidateIds') is distinct from 'array'
    or new.payload - 'ballotType' - 'candidateIds' <> '{}'::jsonb then
    raise exception '同时支持选票数据无效。';
  end if;
  if jsonb_array_length(new.payload->'candidateIds') <> 2 or exists (
    select 1 from jsonb_array_elements(new.payload->'candidateIds') item where jsonb_typeof(item) <> 'string'
  ) then raise exception '同时支持选票必须包含两个不同选项。'; end if;
  select array_agg(value::uuid order by value::uuid) into v_selected
    from jsonb_array_elements_text(new.payload->'candidateIds');
  select array_agg(id order by id) into v_candidates from public.candidates
    where contest_id = new.contest_id and is_active;
  if cardinality(v_candidates) is distinct from 2 or v_selected is distinct from v_candidates then
    raise exception '同时支持的两个选项必须与当前候选项一致，请刷新后重新选择。';
  end if;
  if exists (select 1 from public.love_vote_allocations where vote_id = new.id) then
    raise exception '同时支持票不能使用或补投真爱票。';
  end if;
  return new;
end;
$$;
revoke all on function buttervote_private.validate_both_support_vote() from public, anon, authenticated;
create trigger validate_both_support_vote
before insert or update of payload, contest_id on public.votes
for each row execute function buttervote_private.validate_both_support_vote();

create or replace function buttervote_private.reject_both_support_love_vote()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_payload jsonb;
begin
  select payload into v_payload from public.votes where id = new.vote_id for update;
  if v_payload->>'ballotType' = 'both_support' then
    raise exception '同时支持票不能使用或补投真爱票。';
  end if;
  return new;
end;
$$;
revoke all on function buttervote_private.reject_both_support_love_vote() from public, anon, authenticated;
create trigger reject_both_support_love_vote
before insert or update of vote_id on public.love_vote_allocations
for each row execute function buttervote_private.reject_both_support_love_vote();

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
  v_love_candidate_ids uuid[];
  v_new_love_count int;
  v_vote_type text;
  v_max_choices int;
  v_require_exact_choices boolean;
  v_selected_candidate_ids uuid[] := array[]::uuid[];
  v_selected_count int := 0;
  v_is_both_support boolean;
begin
  select coalesce(array_agg(distinct candidate_id), array[]::uuid[])
    into v_love_candidate_ids
  from unnest(coalesce(p_love_candidate_ids, array[]::uuid[])) as love_ids(candidate_id);

  v_new_love_count := coalesce(array_length(v_love_candidate_ids, 1), 0);

  select
    c.group_id,
    c.love_vote_enabled,
    c.vote_type,
    c.max_choices,
    c.require_exact_choices,
    g.love_vote_quota,
    g.love_vote_weight
    into
      v_group_id,
      v_love_vote_enabled,
      v_vote_type,
      v_max_choices,
      v_require_exact_choices,
      v_love_vote_quota,
      v_love_vote_weight
  from public.contests c
  left join public.contest_groups g on g.id = c.group_id
  where c.id = p_contest_id
    and c.status = 'voting'
    and c.archived_at is null
  for update of c;

  if not found then
    raise exception '该活动当前不能投票。';
  end if;

  perform 1 from public.profiles where id = p_voter_id for update;
  if not found then
    raise exception '投票用户不存在。';
  end if;

  v_is_both_support := coalesce(p_payload->>'ballotType', '') = 'both_support';
  if v_is_both_support then
    if v_vote_type <> 'single' then raise exception '该活动不能同时支持两项。'; end if;
    select array_agg(value::uuid) into v_selected_candidate_ids
      from jsonb_array_elements_text(p_payload->'candidateIds');
  elsif v_vote_type = 'single' then
    if p_payload->>'candidateId' is null then
      raise exception '请选择有效候选项。';
    end if;
    v_selected_candidate_ids := array[(p_payload->>'candidateId')::uuid];
  elsif v_vote_type = 'multiple' then
    select coalesce(array_agg(distinct value::uuid), array[]::uuid[])
      into v_selected_candidate_ids
    from jsonb_array_elements_text(coalesce(p_payload->'candidateIds', '[]'::jsonb)) as ids(value);
  elsif v_vote_type = 'ranked' then
    select coalesce(array_agg(distinct value::uuid), array[]::uuid[])
      into v_selected_candidate_ids
    from jsonb_array_elements_text(coalesce(p_payload->'ranking', '[]'::jsonb)) as ids(value);
  else
    raise exception '投票类型无效。';
  end if;

  v_selected_count := coalesce(array_length(v_selected_candidate_ids, 1), 0);

  if v_vote_type = 'ranked' and v_selected_count > 3 then
    raise exception '排名投票最多支持三个候选项。';
  end if;

  if v_selected_count < 1 then
    raise exception '请至少选择一个候选项。';
  end if;

  if not v_is_both_support and v_selected_count > v_max_choices then
    raise exception '最多只能选择 % 个候选项。', v_max_choices;
  end if;

  if not v_is_both_support and v_require_exact_choices and v_selected_count <> v_max_choices then
    raise exception '该活动需要选择 % 个候选项。', v_max_choices;
  end if;

  if exists (
    select 1
    from unnest(v_selected_candidate_ids) as selected(candidate_id)
    left join public.candidates c
      on c.id = selected.candidate_id
      and c.contest_id = p_contest_id
      and c.is_active = true
    where c.id is null
  ) then
    raise exception '候选项不属于当前活动。';
  end if;

  if v_new_love_count > 0 then
    if v_group_id is null or v_love_vote_enabled = false then
      raise exception '该活动不能使用真爱票。';
    end if;

    if coalesce(v_love_vote_quota, 0) <= 0 or coalesce(v_love_vote_weight, 0) <= 1 then
      raise exception '该活动不能使用真爱票。';
    end if;

    if exists (
      select 1
      from unnest(v_love_candidate_ids) as love(candidate_id)
      left join unnest(v_selected_candidate_ids) as selected(candidate_id)
        on selected.candidate_id = love.candidate_id
      where selected.candidate_id is null
    ) then
      raise exception '真爱票只能投给本次已选择的候选项。';
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

  if v_is_both_support and coalesce(cardinality(v_love_candidate_ids), 0) > 0 then
    raise exception '同时支持票不能使用或补投真爱票。';
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
    from unnest(v_love_candidate_ids) as love_ids(candidate_id);
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
  v_love_candidate_ids uuid[] := array[]::uuid[];
  v_inserted_count int := 0;
  v_existing_love_count int := 0;
  v_new_love_count int := 0;
  v_love_vote_quota int;
  v_love_vote_weight numeric;
  v_love_vote_enabled boolean;
  v_vote_type text;
  v_max_choices int;
  v_require_exact_choices boolean;
  v_selected_candidate_ids uuid[] := array[]::uuid[];
  v_selected_count int := 0;
  v_is_both_support boolean;
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
  if not found then
    raise exception '投票用户不存在。';
  end if;

  select count(*)::int
    into v_existing_love_count
  from public.love_vote_allocations
  where group_id = p_group_id
    and voter_id = p_voter_id;

  for v_vote_item in
    select value from jsonb_array_elements(v_votes) as items(value)
  loop
    v_contest_id := (v_vote_item->>'contestId')::uuid;
    v_payload := v_vote_item->'payload';

    if v_contest_id is null or v_payload is null then
      raise exception '组内投票数据无效。';
    end if;

    select
      c.love_vote_enabled,
      c.vote_type,
      c.max_choices,
      c.require_exact_choices
      into
        v_love_vote_enabled,
        v_vote_type,
        v_max_choices,
        v_require_exact_choices
    from public.contests c
    where c.id = v_contest_id
      and c.group_id = p_group_id
      and c.status = 'voting'
      and c.archived_at is null
    for update of c;

    if not found then
      raise exception '提交的活动必须属于当前活动组且正在投票。';
    end if;

    v_is_both_support := coalesce(v_payload->>'ballotType', '') = 'both_support';
    if v_is_both_support then
      if v_vote_type <> 'single' then raise exception '该活动不能同时支持两项。'; end if;
      select array_agg(value::uuid) into v_selected_candidate_ids
        from jsonb_array_elements_text(v_payload->'candidateIds');
    elsif v_vote_type = 'single' then
      if v_payload->>'candidateId' is null then
        raise exception '请选择有效候选项。';
      end if;
      v_selected_candidate_ids := array[(v_payload->>'candidateId')::uuid];
    elsif v_vote_type = 'multiple' then
      select coalesce(array_agg(distinct value::uuid), array[]::uuid[])
        into v_selected_candidate_ids
      from jsonb_array_elements_text(coalesce(v_payload->'candidateIds', '[]'::jsonb)) as ids(value);
    elsif v_vote_type = 'ranked' then
      select coalesce(array_agg(distinct value::uuid), array[]::uuid[])
        into v_selected_candidate_ids
      from jsonb_array_elements_text(coalesce(v_payload->'ranking', '[]'::jsonb)) as ids(value);
    else
      raise exception '投票类型无效。';
    end if;

    v_selected_count := coalesce(array_length(v_selected_candidate_ids, 1), 0);

    if v_vote_type = 'ranked' and v_selected_count > 3 then
      raise exception '排名投票最多支持三个候选项。';
    end if;

    if v_selected_count < 1 then
      raise exception '请至少选择一个候选项。';
    end if;

    if not v_is_both_support and v_selected_count > v_max_choices then
      raise exception '最多只能选择 % 个候选项。', v_max_choices;
    end if;

    if not v_is_both_support and v_require_exact_choices and v_selected_count <> v_max_choices then
      raise exception '该活动需要选择 % 个候选项。', v_max_choices;
    end if;

    if exists (
      select 1
      from unnest(v_selected_candidate_ids) as selected(candidate_id)
      left join public.candidates c
        on c.id = selected.candidate_id
        and c.contest_id = v_contest_id
        and c.is_active = true
      where c.id is null
    ) then
      raise exception '选中的候选项不属于对应活动。';
    end if;

    select coalesce(array_agg(distinct value::uuid), array[]::uuid[])
      into v_love_candidate_ids
    from jsonb_array_elements_text(
      coalesce(v_vote_item->'loveCandidateIds', '[]'::jsonb)
    ) as love_ids(value);

    if coalesce(array_length(v_love_candidate_ids, 1), 0) > 0 then
      if v_love_vote_enabled = false
        or coalesce(v_love_vote_quota, 0) <= 0
        or coalesce(v_love_vote_weight, 0) <= 1 then
        raise exception '该活动不能使用真爱票。';
      end if;

      if exists (
        select 1
        from unnest(v_love_candidate_ids) as love(candidate_id)
        left join unnest(v_selected_candidate_ids) as selected(candidate_id)
          on selected.candidate_id = love.candidate_id
        where selected.candidate_id is null
      ) then
        raise exception '真爱票只能给已选择的候选项。';
      end if;

      v_new_love_count :=
        v_new_love_count + coalesce(array_length(v_love_candidate_ids, 1), 0);

      if v_existing_love_count + v_new_love_count > v_love_vote_quota then
        raise exception '该活动组最多可使用 % 张真爱票。', v_love_vote_quota;
      end if;
    end if;

    if v_is_both_support and coalesce(cardinality(v_love_candidate_ids), 0) > 0 then
      raise exception '同时支持票不能使用或补投真爱票。';
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
      from unnest(v_love_candidate_ids) as love_ids(candidate_id);
    end if;

    v_inserted_count := v_inserted_count + 1;
  end loop;

  return v_inserted_count;
end;
$$;

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

    if v_vote_payload->>'ballotType' = 'both_support' then
      raise exception '同时支持票不能使用或补投真爱票。';
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
    where vote.vote_type = 'single' and vote.payload->>'ballotType' is distinct from 'both_support'

    union all

    select vote.id, vote.contest_id, selected.candidate_id_text,
      1::double precision, null::timestamptz, vote.love_vote_weight
    from visible_votes vote
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(vote.payload->'candidateIds') = 'array'
        then vote.payload->'candidateIds' else '[]'::jsonb end
    ) selected(candidate_id_text)
    where vote.vote_type = 'single' and vote.payload->>'ballotType' = 'both_support'

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
      and point.created_at is not null -- Both-support points have no time or love weighting.
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

-- CREATE OR REPLACE preserves existing privileges; restate the intended RPC boundary.
revoke all on function public.submit_vote_with_love(uuid, uuid, jsonb, uuid[]) from public, anon, authenticated;
revoke all on function public.submit_group_votes_with_love(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.supplement_love_votes(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.submit_vote_with_love(uuid, uuid, jsonb, uuid[]) to service_role;
grant execute on function public.submit_group_votes_with_love(uuid, uuid, jsonb) to service_role;
grant execute on function public.supplement_love_votes(uuid, uuid, jsonb) to service_role;
notify pgrst, 'reload schema';
