create or replace function public.create_preliminary_tiebreakers_atomic(
  p_tournament_id uuid,
  p_target_group_id uuid,
  p_seed text,
  p_input jsonb,
  p_output jsonb,
  p_tiebreakers jsonb,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tournament_name text;
  v_tiebreaker_item jsonb;
  v_candidate_item jsonb;
  v_group_key text;
  v_source_candidate_id uuid;
  v_source_candidate record;
  v_entry_id uuid;
  v_nomination_id uuid;
  v_new_candidate_id uuid;
  v_contest_id uuid;
  v_stage_id uuid;
  v_log_id uuid;
  v_sequence int;
  v_entry_count int := 0;
  v_contest_ids jsonb := '[]'::jsonb;
  v_stage_ids jsonb := '[]'::jsonb;
  v_entries jsonb := '[]'::jsonb;
  v_final_output jsonb;
begin
  if jsonb_typeof(coalesce(p_tiebreakers, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_tiebreakers, '[]'::jsonb)) = 0 then
    raise exception '没有需要生成的加赛。';
  end if;

  select name
    into v_tournament_name
  from public.tournaments
  where id = p_tournament_id
  for update;

  if not found then
    raise exception '赛事不存在。';
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
      and kind = 'tiebreaker'
  ) then
    raise exception '该赛事已经生成过预赛加赛。';
  end if;

  select coalesce(max(sequence), 1) + 1
    into v_sequence
  from public.tournament_stages
  where tournament_id = p_tournament_id;

  for v_tiebreaker_item in
    select value from jsonb_array_elements(p_tiebreakers) as items(value)
  loop
    v_group_key := upper(coalesce(v_tiebreaker_item->>'preliminaryGroup', ''));
    if v_group_key not in ('A', 'B', 'C', 'D') then
      raise exception '预赛加赛组别无效。';
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
      v_tournament_name || ' 预赛加赛 ' || v_group_key || ' 组',
      '由赛制工具自动生成。单选，投票时长 24 小时。',
      'draft',
      'single',
      1,
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
      'tiebreaker',
      v_contest_id,
      p_target_group_id,
      v_sequence,
      'draft',
      coalesce(v_tiebreaker_item->'metadata', '{}'::jsonb)
        || jsonb_build_object(
          'preliminaryGroup', v_group_key,
          'durationHours', 24,
          'maxChoices', 1
        )
    )
    returning id into v_stage_id;

    v_contest_ids := v_contest_ids || jsonb_build_array(v_contest_id);
    v_stage_ids := v_stage_ids || jsonb_build_array(v_stage_id);

    for v_candidate_item in
      select value
      from jsonb_array_elements(
        coalesce(v_tiebreaker_item->'candidates', '[]'::jsonb)
      ) as candidates(value)
    loop
      v_source_candidate_id := (v_candidate_item->>'candidateId')::uuid;

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
        into v_source_candidate
      from public.candidates c
      where c.id = v_source_candidate_id
        and c.is_active = true;

      if not found then
        raise exception '包含不存在或不可继承的加赛候选项。';
      end if;

      select id
        into v_entry_id
      from public.tournament_entries
      where tournament_id = p_tournament_id
        and (
          current_candidate_id = v_source_candidate.id
          or source_candidate_id = v_source_candidate.id
          or root_candidate_id = v_source_candidate.id
        )
      for update;

      if not found then
        raise exception '加赛候选项尚未登记到赛事。';
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

      update public.tournament_entries
      set
        current_candidate_id = v_new_candidate_id,
        source_candidate_id = v_source_candidate.id,
        preliminary_group = v_group_key,
        status = 'tiebreaker',
        updated_at = now()
      where id = v_entry_id;

      v_entry_count := v_entry_count + 1;
      v_entries := v_entries || jsonb_build_array(
        jsonb_build_object(
          'entryId', v_entry_id,
          'sourceCandidateId', v_source_candidate.id,
          'currentCandidateId', v_new_candidate_id,
          'preliminaryGroup', v_group_key
        )
      );
    end loop;

    v_sequence := v_sequence + 1;
  end loop;

  v_final_output := coalesce(p_output, '{}'::jsonb)
    || jsonb_build_object(
      'contestIds', v_contest_ids,
      'stageIds', v_stage_ids,
      'entryCount', v_entry_count,
      'entries', v_entries
    );

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
    (v_stage_ids->>0)::uuid,
    'preliminary_tiebreaker_generation',
    p_seed,
    coalesce(p_input, '{}'::jsonb),
    v_final_output,
    p_created_by
  )
  returning id into v_log_id;

  return v_final_output || jsonb_build_object('drawLogId', v_log_id);
end;
$$;

create or replace function public.create_knockout_stage_atomic(
  p_tournament_id uuid,
  p_target_group_id uuid,
  p_seed text,
  p_input jsonb,
  p_output jsonb,
  p_entries jsonb,
  p_matches jsonb,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tournament_name text;
  v_entry_item jsonb;
  v_match_item jsonb;
  v_entry_id uuid;
  v_selected_entry_ids uuid[] := array[]::uuid[];
  v_group_key text;
  v_preliminary_rank int;
  v_is_group_winner boolean;
  v_round text := 'round_of_16';
  v_match_slot int;
  v_left_slot int;
  v_right_slot int;
  v_left_entry_id uuid;
  v_right_entry_id uuid;
  v_participant_entry_id uuid;
  v_participant record;
  v_source_candidate record;
  v_nomination_id uuid;
  v_new_candidate_id uuid;
  v_contest_id uuid;
  v_stage_id uuid;
  v_match_id uuid;
  v_log_id uuid;
  v_sequence int;
  v_contest_ids jsonb := '[]'::jsonb;
  v_stage_ids jsonb := '[]'::jsonb;
  v_match_ids jsonb := '[]'::jsonb;
  v_final_output jsonb;
begin
  if jsonb_typeof(coalesce(p_entries, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_entries, '[]'::jsonb)) <> 16 then
    raise exception '正赛需要 16 名晋级者。';
  end if;

  if jsonb_typeof(coalesce(p_matches, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_matches, '[]'::jsonb)) <> 8 then
    raise exception '正赛首轮需要 8 场比赛。';
  end if;

  select name
    into v_tournament_name
  from public.tournaments
  where id = p_tournament_id
  for update;

  if not found then
    raise exception '赛事不存在。';
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
      and kind = 'knockout'
  ) then
    raise exception '该赛事已经生成过正赛。';
  end if;

  for v_entry_item in
    select value from jsonb_array_elements(p_entries) as entries(value)
  loop
    v_entry_id := (v_entry_item->>'entryId')::uuid;
    v_group_key := upper(coalesce(v_entry_item->>'preliminaryGroup', ''));
    v_preliminary_rank := nullif(v_entry_item->>'preliminaryRank', '')::int;
    v_is_group_winner := coalesce((v_entry_item->>'isGroupWinner')::boolean, false);

    if v_group_key not in ('A', 'B', 'C', 'D') then
      raise exception '正赛晋级者预赛组别无效。';
    end if;

    update public.tournament_entries
    set
      preliminary_group = v_group_key,
      preliminary_rank = v_preliminary_rank,
      is_group_winner = v_is_group_winner,
      status = 'knockout',
      updated_at = now()
    where id = v_entry_id
      and tournament_id = p_tournament_id;

    if not found then
      raise exception '正赛晋级者不存在。';
    end if;

    v_selected_entry_ids := array_append(v_selected_entry_ids, v_entry_id);
  end loop;

  update public.tournament_entries
  set
    status = 'eliminated',
    updated_at = now()
  where tournament_id = p_tournament_id
    and status in ('preliminary', 'tiebreaker')
    and not (id = any(v_selected_entry_ids));

  select coalesce(max(sequence), 1) + 1
    into v_sequence
  from public.tournament_stages
  where tournament_id = p_tournament_id;

  for v_match_item in
    select value from jsonb_array_elements(p_matches) as matches(value)
  loop
    v_match_slot := (v_match_item->>'slot')::int;
    v_left_slot := (v_match_item->>'leftSlot')::int;
    v_right_slot := (v_match_item->>'rightSlot')::int;
    v_left_entry_id := (v_match_item->>'leftEntryId')::uuid;
    v_right_entry_id := (v_match_item->>'rightEntryId')::uuid;

    if v_left_entry_id is null or v_right_entry_id is null then
      raise exception '正赛首轮比赛必须包含两名候选项。';
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
      v_tournament_name || ' 正赛 16 强第 ' || v_match_slot || ' 场',
      '由赛制工具自动生成。单选，投票时长 48 小时。',
      'draft',
      'single',
      1,
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
      'knockout',
      v_contest_id,
      p_target_group_id,
      v_sequence,
      'draft',
      jsonb_build_object(
        'round', v_round,
        'matchSlot', v_match_slot,
        'leftSlot', v_left_slot,
        'rightSlot', v_right_slot,
        'durationHours', 48,
        'maxChoices', 1
      )
    )
    returning id into v_stage_id;

    foreach v_participant_entry_id in array array[v_left_entry_id, v_right_entry_id]
    loop
      select e.id, e.current_candidate_id
        into v_participant
      from public.tournament_entries e
      where e.id = v_participant_entry_id
        and e.tournament_id = p_tournament_id
      for update;

      if not found or v_participant.current_candidate_id is null then
        raise exception '正赛候选项尚未准备好。';
      end if;

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
        into v_source_candidate
      from public.candidates c
      where c.id = v_participant.current_candidate_id
        and c.is_active = true;

      if not found then
        raise exception '正赛来源候选项不存在或不可继承。';
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

      update public.tournament_entries
      set
        current_candidate_id = v_new_candidate_id,
        status = 'knockout',
        updated_at = now()
      where id = v_participant_entry_id;
    end loop;

    insert into public.tournament_matches(
      tournament_id,
      stage_id,
      contest_id,
      round,
      slot,
      left_entry_id,
      right_entry_id,
      metadata
    )
    values (
      p_tournament_id,
      v_stage_id,
      v_contest_id,
      v_round,
      v_match_slot,
      v_left_entry_id,
      v_right_entry_id,
      jsonb_build_object(
        'leftSlot', v_left_slot,
        'rightSlot', v_right_slot
      )
    )
    returning id into v_match_id;

    v_contest_ids := v_contest_ids || jsonb_build_array(v_contest_id);
    v_stage_ids := v_stage_ids || jsonb_build_array(v_stage_id);
    v_match_ids := v_match_ids || jsonb_build_array(v_match_id);
    v_sequence := v_sequence + 1;
  end loop;

  v_final_output := coalesce(p_output, '{}'::jsonb)
    || jsonb_build_object(
      'contestIds', v_contest_ids,
      'stageIds', v_stage_ids,
      'matchIds', v_match_ids
    );

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
    (v_stage_ids->>0)::uuid,
    'knockout_draw',
    p_seed,
    coalesce(p_input, '{}'::jsonb),
    v_final_output,
    p_created_by
  )
  returning id into v_log_id;

return v_final_output || jsonb_build_object('drawLogId', v_log_id);
end;
$$;

create or replace function public.create_knockout_followup_matches_atomic(
  p_tournament_id uuid,
  p_target_group_id uuid,
  p_seed text,
  p_input jsonb,
  p_output jsonb,
  p_source_results jsonb,
  p_matches jsonb,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tournament_name text;
  v_source_item jsonb;
  v_match_item jsonb;
  v_source_match_id uuid;
  v_winner_entry_id uuid;
  v_loser_entry_id uuid;
  v_round text;
  v_source_round text;
  v_participant_kind text;
  v_match_slot int;
  v_left_entry_id uuid;
  v_right_entry_id uuid;
  v_participant_entry_id uuid;
  v_participant record;
  v_source_candidate record;
  v_nomination_id uuid;
  v_new_candidate_id uuid;
  v_contest_id uuid;
  v_stage_id uuid;
  v_match_id uuid;
  v_log_id uuid;
  v_sequence int;
  v_match_title text;
  v_first_stage_id uuid;
  v_contest_ids jsonb := '[]'::jsonb;
  v_stage_ids jsonb := '[]'::jsonb;
  v_match_ids jsonb := '[]'::jsonb;
  v_final_output jsonb;
begin
  if jsonb_typeof(coalesce(p_matches, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_matches, '[]'::jsonb)) = 0 then
    raise exception '没有需要生成的正赛场次。';
  end if;

  if jsonb_typeof(coalesce(p_source_results, '[]'::jsonb)) <> 'array' then
    raise exception '正赛来源结果无效。';
  end if;

  select name
    into v_tournament_name
  from public.tournaments
  where id = p_tournament_id
  for update;

  if not found then
    raise exception '赛事不存在。';
  end if;

  if p_target_group_id is not null and not exists (
    select 1 from public.contest_groups where id = p_target_group_id
  ) then
    raise exception '目标活动组不存在。';
  end if;

  for v_source_item in
    select value
    from jsonb_array_elements(coalesce(p_source_results, '[]'::jsonb))
      as source_results(value)
  loop
    v_source_match_id := (v_source_item->>'matchId')::uuid;
    v_winner_entry_id := (v_source_item->>'winnerEntryId')::uuid;
    v_loser_entry_id := (v_source_item->>'loserEntryId')::uuid;

    if v_source_match_id is null
      or v_winner_entry_id is null
      or v_loser_entry_id is null
      or v_winner_entry_id = v_loser_entry_id then
      raise exception '正赛来源胜负数据不完整。';
    end if;

    if not exists (
      select 1
      from public.tournament_entries
      where tournament_id = p_tournament_id
        and id in (v_winner_entry_id, v_loser_entry_id)
      having count(*) = 2
    ) then
      raise exception '正赛来源选手不存在。';
    end if;

    update public.tournament_matches
    set
      winner_entry_id = v_winner_entry_id,
      loser_entry_id = v_loser_entry_id,
      updated_at = now()
    where id = v_source_match_id
      and tournament_id = p_tournament_id;

    if not found then
      raise exception '正赛来源场次不存在。';
    end if;
  end loop;

  select coalesce(max(sequence), 1) + 1
    into v_sequence
  from public.tournament_stages
  where tournament_id = p_tournament_id;

  for v_match_item in
    select value from jsonb_array_elements(p_matches) as matches(value)
  loop
    v_round := lower(coalesce(v_match_item->>'round', ''));
    v_source_round := lower(coalesce(v_match_item->>'sourceRound', ''));
    v_participant_kind := lower(coalesce(v_match_item->>'participant', 'winner'));
    v_match_slot := nullif(v_match_item->>'slot', '')::int;
    v_left_entry_id := (v_match_item->>'leftEntryId')::uuid;
    v_right_entry_id := (v_match_item->>'rightEntryId')::uuid;

    if v_round not in ('quarterfinal', 'semifinal', 'final', 'third_place') then
      raise exception '正赛轮次无效。';
    end if;

    if v_match_slot is null or v_match_slot <= 0 then
      raise exception '正赛场次编号无效。';
    end if;

    if v_left_entry_id is null
      or v_right_entry_id is null
      or v_left_entry_id = v_right_entry_id then
      raise exception '正赛场次必须包含两名不同选手。';
    end if;

    if exists (
      select 1
      from public.tournament_matches
      where tournament_id = p_tournament_id
        and round = v_round
        and slot = v_match_slot
    ) then
      raise exception '该正赛场次已经生成。';
    end if;

    v_match_title := coalesce(
      nullif(v_match_item->>'title', ''),
      case v_round
        when 'quarterfinal' then '8 强第 ' || v_match_slot || ' 场'
        when 'semifinal' then '半决赛第 ' || v_match_slot || ' 场'
        when 'final' then '冠军赛'
        when 'third_place' then '季军赛'
        else '正赛第 ' || v_match_slot || ' 场'
      end
    );

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
      v_tournament_name || ' ' || v_match_title,
      '由赛制工具自动生成。单选，投票时长 48 小时。',
      'draft',
      'single',
      1,
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
      'knockout',
      v_contest_id,
      p_target_group_id,
      v_sequence,
      'draft',
      jsonb_build_object(
        'round', v_round,
        'matchSlot', v_match_slot,
        'sourceRound', v_source_round,
        'sourceSlots', coalesce(v_match_item->'sourceSlots', '[]'::jsonb),
        'participant', v_participant_kind,
        'durationHours', 48,
        'maxChoices', 1
      )
    )
    returning id into v_stage_id;

    if v_first_stage_id is null then
      v_first_stage_id := v_stage_id;
    end if;

    foreach v_participant_entry_id in array array[v_left_entry_id, v_right_entry_id]
    loop
      select e.id, e.current_candidate_id
        into v_participant
      from public.tournament_entries e
      where e.id = v_participant_entry_id
        and e.tournament_id = p_tournament_id
      for update;

      if not found or v_participant.current_candidate_id is null then
        raise exception '正赛选手尚未准备好。';
      end if;

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
        into v_source_candidate
      from public.candidates c
      where c.id = v_participant.current_candidate_id
        and c.is_active = true;

      if not found then
        raise exception '正赛来源候选不存在或不可继承。';
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

      update public.tournament_entries
      set
        current_candidate_id = v_new_candidate_id,
        status = 'knockout',
        updated_at = now()
      where id = v_participant_entry_id;
    end loop;

    insert into public.tournament_matches(
      tournament_id,
      stage_id,
      contest_id,
      round,
      slot,
      left_entry_id,
      right_entry_id,
      metadata
    )
    values (
      p_tournament_id,
      v_stage_id,
      v_contest_id,
      v_round,
      v_match_slot,
      v_left_entry_id,
      v_right_entry_id,
      jsonb_build_object(
        'sourceRound', v_source_round,
        'sourceSlots', coalesce(v_match_item->'sourceSlots', '[]'::jsonb),
        'participant', v_participant_kind
      )
    )
    returning id into v_match_id;

    v_contest_ids := v_contest_ids || jsonb_build_array(v_contest_id);
    v_stage_ids := v_stage_ids || jsonb_build_array(v_stage_id);
    v_match_ids := v_match_ids || jsonb_build_array(v_match_id);
    v_sequence := v_sequence + 1;
  end loop;

  v_final_output := coalesce(p_output, '{}'::jsonb)
    || jsonb_build_object(
      'contestIds', v_contest_ids,
      'stageIds', v_stage_ids,
      'matchIds', v_match_ids
    );

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
    'knockout_round_generation',
    p_seed,
    coalesce(p_input, '{}'::jsonb),
    v_final_output,
    p_created_by
  )
  returning id into v_log_id;

  return v_final_output || jsonb_build_object('drawLogId', v_log_id);
end;
$$;

revoke all on function public.create_preliminary_tiebreakers_atomic(
  uuid,
  uuid,
  text,
  jsonb,
  jsonb,
  jsonb,
  uuid
) from public, anon, authenticated;

revoke all on function public.create_knockout_stage_atomic(
  uuid,
  uuid,
  text,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  uuid
) from public, anon, authenticated;

revoke all on function public.create_knockout_followup_matches_atomic(
  uuid,
  uuid,
  text,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  uuid
) from public, anon, authenticated;

grant execute on function public.create_preliminary_tiebreakers_atomic(
  uuid,
  uuid,
  text,
  jsonb,
  jsonb,
  jsonb,
  uuid
) to service_role;

grant execute on function public.create_knockout_followup_matches_atomic(
  uuid,
  uuid,
  text,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  uuid
) to service_role;

grant execute on function public.create_knockout_stage_atomic(
  uuid,
  uuid,
  text,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  uuid
) to service_role;
