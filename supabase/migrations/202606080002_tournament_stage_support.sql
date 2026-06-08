create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'draft' check (
    status in ('draft', 'active', 'completed', 'archived')
  ),
  config jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tournament_stages (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  kind text not null check (
    kind in ('screening', 'preliminary', 'tiebreaker', 'knockout')
  ),
  contest_id uuid references public.contests(id) on delete set null,
  group_id uuid references public.contest_groups(id) on delete set null,
  sequence int not null default 1 check (sequence >= 1),
  status text not null default 'draft' check (
    status in ('draft', 'waiting', 'voting', 'closed', 'published')
  ),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tournament_entries (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  root_candidate_id uuid not null references public.candidates(id) on delete cascade,
  current_candidate_id uuid references public.candidates(id) on delete set null,
  source_candidate_id uuid references public.candidates(id) on delete set null,
  screening_rank int,
  preliminary_group text check (
    preliminary_group is null or preliminary_group in ('A', 'B', 'C', 'D')
  ),
  preliminary_rank int,
  is_group_winner boolean not null default false,
  status text not null default 'screening' check (
    status in (
      'screening',
      'preliminary',
      'tiebreaker',
      'knockout',
      'eliminated',
      'champion',
      'withdrawn'
    )
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tournament_id, root_candidate_id)
);

create table if not exists public.tournament_draw_logs (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  stage_id uuid references public.tournament_stages(id) on delete set null,
  kind text not null,
  seed text not null,
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.tournament_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  stage_id uuid references public.tournament_stages(id) on delete set null,
  contest_id uuid references public.contests(id) on delete set null,
  round text not null,
  slot int not null check (slot >= 1),
  left_entry_id uuid references public.tournament_entries(id) on delete set null,
  right_entry_id uuid references public.tournament_entries(id) on delete set null,
  winner_entry_id uuid references public.tournament_entries(id) on delete set null,
  loser_entry_id uuid references public.tournament_entries(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tournament_id, round, slot)
);

create index if not exists tournament_stages_tournament_sequence_idx
  on public.tournament_stages(tournament_id, sequence, kind);
create index if not exists tournament_stages_contest_idx
  on public.tournament_stages(contest_id);
create index if not exists tournament_entries_tournament_status_idx
  on public.tournament_entries(tournament_id, status);
create index if not exists tournament_entries_current_candidate_idx
  on public.tournament_entries(current_candidate_id);
create index if not exists tournament_entries_source_candidate_idx
  on public.tournament_entries(source_candidate_id);
create index if not exists tournament_draw_logs_tournament_created_idx
  on public.tournament_draw_logs(tournament_id, created_at);
create index if not exists tournament_matches_stage_round_slot_idx
  on public.tournament_matches(stage_id, round, slot);

drop trigger if exists set_tournaments_updated_at on public.tournaments;
create trigger set_tournaments_updated_at
before update on public.tournaments
for each row
execute function public.set_updated_at();

drop trigger if exists set_tournament_stages_updated_at
on public.tournament_stages;
create trigger set_tournament_stages_updated_at
before update on public.tournament_stages
for each row
execute function public.set_updated_at();

drop trigger if exists set_tournament_entries_updated_at
on public.tournament_entries;
create trigger set_tournament_entries_updated_at
before update on public.tournament_entries
for each row
execute function public.set_updated_at();

drop trigger if exists set_tournament_matches_updated_at
on public.tournament_matches;
create trigger set_tournament_matches_updated_at
before update on public.tournament_matches
for each row
execute function public.set_updated_at();

alter table public.tournaments enable row level security;
alter table public.tournament_stages enable row level security;
alter table public.tournament_entries enable row level security;
alter table public.tournament_draw_logs enable row level security;
alter table public.tournament_matches enable row level security;

drop policy if exists "Anyone can read tournaments" on public.tournaments;
create policy "Anyone can read tournaments"
on public.tournaments
for select
to anon, authenticated
using (true);

drop policy if exists "Admins can manage tournaments" on public.tournaments;
create policy "Admins can manage tournaments"
on public.tournaments
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Anyone can read tournament stages" on public.tournament_stages;
create policy "Anyone can read tournament stages"
on public.tournament_stages
for select
to anon, authenticated
using (true);

drop policy if exists "Admins can manage tournament stages" on public.tournament_stages;
create policy "Admins can manage tournament stages"
on public.tournament_stages
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Anyone can read tournament entries" on public.tournament_entries;
create policy "Anyone can read tournament entries"
on public.tournament_entries
for select
to anon, authenticated
using (true);

drop policy if exists "Admins can manage tournament entries" on public.tournament_entries;
create policy "Admins can manage tournament entries"
on public.tournament_entries
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Anyone can read tournament draw logs" on public.tournament_draw_logs;
create policy "Anyone can read tournament draw logs"
on public.tournament_draw_logs
for select
to anon, authenticated
using (true);

drop policy if exists "Admins can manage tournament draw logs" on public.tournament_draw_logs;
create policy "Admins can manage tournament draw logs"
on public.tournament_draw_logs
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "Anyone can read tournament matches" on public.tournament_matches;
create policy "Anyone can read tournament matches"
on public.tournament_matches
for select
to anon, authenticated
using (true);

drop policy if exists "Admins can manage tournament matches" on public.tournament_matches;
create policy "Admins can manage tournament matches"
on public.tournament_matches
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

revoke all on public.tournaments from anon, authenticated;
revoke all on public.tournament_stages from anon, authenticated;
revoke all on public.tournament_entries from anon, authenticated;
revoke all on public.tournament_draw_logs from anon, authenticated;
revoke all on public.tournament_matches from anon, authenticated;

grant select on public.tournaments to anon, authenticated;
grant select on public.tournament_stages to anon, authenticated;
grant select on public.tournament_entries to anon, authenticated;
grant select on public.tournament_draw_logs to anon, authenticated;
grant select on public.tournament_matches to anon, authenticated;

grant insert, update, delete on public.tournaments to authenticated;
grant insert, update, delete on public.tournament_stages to authenticated;
grant insert, update, delete on public.tournament_entries to authenticated;
grant insert, update, delete on public.tournament_draw_logs to authenticated;
grant insert, update, delete on public.tournament_matches to authenticated;

create or replace function public.create_tournament_with_screening_stage_atomic(
  p_name text,
  p_screening_contest_id uuid,
  p_config jsonb,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tournament_id uuid;
  v_stage_id uuid;
  v_contest_status text;
begin
  select status
    into v_contest_status
  from public.contests
  where id = p_screening_contest_id;

  if not found then
    raise exception '海选活动不存在。';
  end if;

  insert into public.tournaments(
    name,
    status,
    config,
    created_by
  )
  values (
    p_name,
    'draft',
    coalesce(p_config, '{}'::jsonb),
    p_created_by
  )
  returning id into v_tournament_id;

  insert into public.tournament_stages(
    tournament_id,
    kind,
    contest_id,
    sequence,
    status,
    metadata
  )
  values (
    v_tournament_id,
    'screening',
    p_screening_contest_id,
    1,
    case
      when v_contest_status in ('waiting', 'voting', 'closed', 'published')
        then v_contest_status
      else 'draft'
    end,
    jsonb_build_object(
      'durationHours', 72,
      'advancerLimit', 48
    )
  )
  returning id into v_stage_id;

  return jsonb_build_object(
    'tournamentId', v_tournament_id,
    'screeningStageId', v_stage_id
  );
end;
$$;

create or replace function public.create_preliminary_stage_atomic(
  p_tournament_id uuid,
  p_screening_stage_id uuid,
  p_target_group_id uuid,
  p_seed text,
  p_input jsonb,
  p_output jsonb,
  p_groups jsonb,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tournament_name text;
  v_screening_contest_id uuid;
  v_group_item jsonb;
  v_candidate_item jsonb;
  v_group_key text;
  v_source_candidate_id uuid;
  v_screening_rank int;
  v_source_candidate record;
  v_nomination_id uuid;
  v_new_candidate_id uuid;
  v_entry_id uuid;
  v_contest_id uuid;
  v_stage_id uuid;
  v_first_stage_id uuid;
  v_log_id uuid;
  v_sequence int := 2;
  v_entry_count int := 0;
  v_contest_ids jsonb := '[]'::jsonb;
  v_stage_ids jsonb := '[]'::jsonb;
  v_entries jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(coalesce(p_groups, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_groups, '[]'::jsonb)) = 0 then
    raise exception '预赛分组数据无效。';
  end if;

  select name
    into v_tournament_name
  from public.tournaments
  where id = p_tournament_id
  for update;

  if not found then
    raise exception '赛事不存在。';
  end if;

  select contest_id
    into v_screening_contest_id
  from public.tournament_stages
  where id = p_screening_stage_id
    and tournament_id = p_tournament_id
    and kind = 'screening';

  if not found or v_screening_contest_id is null then
    raise exception '海选阶段不存在。';
  end if;

  if p_target_group_id is not null and not exists (
    select 1 from public.contest_groups where id = p_target_group_id
  ) then
    raise exception '目标活动组不存在。';
  end if;

  if exists (
    select 1
    from public.tournament_stages
    where tournament_id = p_tournament_id
      and kind = 'preliminary'
  ) then
    raise exception '该赛事已经生成过预赛。';
  end if;

  for v_group_item in
    select value from jsonb_array_elements(p_groups) as groups(value)
  loop
    v_group_key := upper(coalesce(v_group_item->>'group', ''));
    if v_group_key not in ('A', 'B', 'C', 'D') then
      raise exception '预赛组别无效。';
    end if;

    insert into public.contests(
      title,
      description,
      status,
      vote_type,
      max_choices,
      require_exact_choices,
      group_id,
      show_candidate_image,
      show_candidate_description,
      show_nominator_info,
      show_existing_nominations,
      max_nominations_per_user,
      live_results_enabled,
      closed_result_visibility,
      love_vote_enabled,
      created_by
    )
    values (
      v_tournament_name || ' 48 进 16 预赛 ' || v_group_key || ' 组',
      '由赛制工具自动生成。每组最多投 4 名，投票时长 72 小时。',
      'draft',
      'multiple',
      4,
      false,
      p_target_group_id,
      true,
      true,
      true,
      false,
      null,
      false,
      'admin_only',
      false,
      p_created_by
    )
    returning id into v_contest_id;

    insert into public.tournament_stages(
      tournament_id,
      kind,
      contest_id,
      group_id,
      sequence,
      status,
      metadata
    )
    values (
      p_tournament_id,
      'preliminary',
      v_contest_id,
      p_target_group_id,
      v_sequence,
      'draft',
      jsonb_build_object(
        'preliminaryGroup', v_group_key,
        'durationHours', 72,
        'maxChoices', 4
      )
    )
    returning id into v_stage_id;

    if v_first_stage_id is null then
      v_first_stage_id := v_stage_id;
    end if;

    v_contest_ids := v_contest_ids || jsonb_build_array(v_contest_id);
    v_stage_ids := v_stage_ids || jsonb_build_array(v_stage_id);

    for v_candidate_item in
      select value
      from jsonb_array_elements(coalesce(v_group_item->'candidates', '[]'::jsonb))
        as candidates(value)
    loop
      v_source_candidate_id := (v_candidate_item->>'candidateId')::uuid;
      v_screening_rank := nullif(v_candidate_item->>'screeningRank', '')::int;

      select
        c.id,
        coalesce(c.inherited_from_candidate_id, c.id) as root_candidate_id,
        c.name,
        c.description,
        c.image_path,
        c.image_width,
        c.image_height,
        c.image_size,
        c.nominator_display_name,
        c.nominator_note
        into v_source_candidate
      from public.candidates c
      where c.id = v_source_candidate_id
        and c.contest_id = v_screening_contest_id
        and c.is_active = true;

      if not found then
        raise exception '包含不存在或不可继承的海选候选项。';
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
        v_contest_id,
        null,
        v_source_candidate.name,
        v_source_candidate.description,
        'approved',
        v_source_candidate.image_path,
        v_source_candidate.image_width,
        v_source_candidate.image_height,
        v_source_candidate.image_size,
        v_source_candidate.nominator_display_name,
        v_source_candidate.nominator_note
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
        v_contest_id,
        v_nomination_id,
        v_source_candidate.name,
        v_source_candidate.description,
        v_source_candidate.image_path,
        v_source_candidate.image_width,
        v_source_candidate.image_height,
        v_source_candidate.image_size,
        v_source_candidate.nominator_display_name,
        v_source_candidate.nominator_note,
        v_source_candidate.id
      )
      returning id into v_new_candidate_id;

      insert into public.tournament_entries(
        tournament_id,
        root_candidate_id,
        current_candidate_id,
        source_candidate_id,
        screening_rank,
        preliminary_group,
        status
      )
      values (
        p_tournament_id,
        v_source_candidate.root_candidate_id,
        v_new_candidate_id,
        v_source_candidate.id,
        v_screening_rank,
        v_group_key,
        'preliminary'
      )
      on conflict (tournament_id, root_candidate_id) do update
      set
        current_candidate_id = excluded.current_candidate_id,
        source_candidate_id = excluded.source_candidate_id,
        screening_rank = excluded.screening_rank,
        preliminary_group = excluded.preliminary_group,
        status = excluded.status,
        updated_at = now()
      returning id into v_entry_id;

      v_entry_count := v_entry_count + 1;
      v_entries := v_entries || jsonb_build_array(
        jsonb_build_object(
          'entryId', v_entry_id,
          'sourceCandidateId', v_source_candidate.id,
          'currentCandidateId', v_new_candidate_id,
          'preliminaryGroup', v_group_key,
          'screeningRank', v_screening_rank
        )
      );
    end loop;

    v_sequence := v_sequence + 1;
  end loop;

  insert into public.tournament_draw_logs(
    tournament_id,
    stage_id,
    kind,
    seed,
    input,
    output,
    created_by
  )
  values (
    p_tournament_id,
    v_first_stage_id,
    'preliminary_draw',
    p_seed,
    coalesce(p_input, '{}'::jsonb),
    coalesce(p_output, '{}'::jsonb),
    p_created_by
  )
  returning id into v_log_id;

  update public.tournaments
  set status = 'active'
  where id = p_tournament_id
    and status = 'draft';

  return jsonb_build_object(
    'contestIds', v_contest_ids,
    'stageIds', v_stage_ids,
    'entryCount', v_entry_count,
    'entries', v_entries,
    'drawLogId', v_log_id
  );
end;
$$;

revoke all on function public.create_tournament_with_screening_stage_atomic(
  text,
  uuid,
  jsonb,
  uuid
) from public, anon, authenticated;

grant execute on function public.create_tournament_with_screening_stage_atomic(
  text,
  uuid,
  jsonb,
  uuid
) to service_role;

revoke all on function public.create_preliminary_stage_atomic(
  uuid,
  uuid,
  uuid,
  text,
  jsonb,
  jsonb,
  jsonb,
  uuid
) from public, anon, authenticated;

grant execute on function public.create_preliminary_stage_atomic(
  uuid,
  uuid,
  uuid,
  text,
  jsonb,
  jsonb,
  jsonb,
  uuid
) to service_role;
