drop policy if exists "Anyone can read public contests" on public.contests;
create policy "Anyone can read public contests"
on public.contests
for select
to anon, authenticated
using (status <> 'draft' and archived_at is null);

create or replace function public.can_view_contest_results(p_contest_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.contests c
    where c.id = p_contest_id
      and c.archived_at is null
      and (
        public.is_admin()
        or c.status = 'published'
        or (c.status = 'closed' and c.closed_result_visibility = 'public')
        or (c.status = 'voting' and c.live_results_enabled = true)
      )
  );
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
set search_path = public
as $$
  select v.id, v.contest_id, v.payload, v.created_at
  from public.votes v
  join public.contests c on c.id = v.contest_id
  where v.contest_id = p_contest_id
    and c.archived_at is null
    and public.can_view_contest_results(p_contest_id)
  order by v.created_at asc;
$$;

create or replace function public.get_contest_love_vote_allocations(p_contest_id uuid)
returns table (
  vote_id uuid,
  candidate_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select l.vote_id, l.candidate_id
  from public.love_vote_allocations l
  join public.contests c on c.id = l.contest_id
  where l.contest_id = p_contest_id
    and c.archived_at is null
    and public.can_view_contest_results(p_contest_id)
  order by l.created_at asc;
$$;

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

  if v_vote_type = 'single' then
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

  if v_selected_count > v_max_choices then
    raise exception '最多只能选择 % 个候选项。', v_max_choices;
  end if;

  if v_require_exact_choices and v_selected_count <> v_max_choices then
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

    if v_vote_type = 'single' then
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

    if v_selected_count > v_max_choices then
      raise exception '最多只能选择 % 个候选项。', v_max_choices;
    end if;

    if v_require_exact_choices and v_selected_count <> v_max_choices then
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

revoke all on function public.apply_due_scheduled_transitions(uuid)
from public, anon, authenticated;
grant execute on function public.apply_due_scheduled_transitions(uuid)
to service_role;

revoke all on function public.submit_vote_with_love(uuid, uuid, jsonb, uuid[])
from public, anon, authenticated;
revoke all on function public.submit_group_votes_with_love(uuid, uuid, jsonb)
from public, anon, authenticated;

grant execute on function public.submit_vote_with_love(uuid, uuid, jsonb, uuid[])
to service_role;
grant execute on function public.submit_group_votes_with_love(uuid, uuid, jsonb)
to service_role;

grant execute on function public.can_view_contest_results(uuid)
to anon, authenticated;
grant execute on function public.get_contest_vote_payloads(uuid)
to anon, authenticated;
grant execute on function public.get_contest_love_vote_allocations(uuid)
to anon, authenticated;
