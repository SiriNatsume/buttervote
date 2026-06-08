create or replace function public.apply_due_scheduled_transitions(
  p_contest_id uuid default null
)
returns table (
  transition_id uuid,
  contest_id uuid,
  target_status text,
  run_at timestamptz,
  group_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  transition_record record;
  affected_group_id uuid;
begin
  for transition_record in
    select
      t.id,
      t.contest_id,
      t.target_status,
      t.run_at
    from public.contest_scheduled_transitions t
    where t.executed_at is null
      and t.run_at <= now()
      and (p_contest_id is null or t.contest_id = p_contest_id)
    order by t.run_at asc, t.created_at asc
    for update skip locked
  loop
    update public.contests c
    set
      status = transition_record.target_status,
      voting_starts_at = case
        when transition_record.target_status = 'voting' then transition_record.run_at
        else c.voting_starts_at
      end,
      voting_ends_at = case
        when transition_record.target_status = 'closed' then transition_record.run_at
        else c.voting_ends_at
      end
    where c.id = transition_record.contest_id
    returning c.group_id into affected_group_id;

    if found then
      update public.contest_scheduled_transitions t
      set executed_at = now()
      where t.id = transition_record.id
        and t.executed_at is null;

      transition_id := transition_record.id;
      contest_id := transition_record.contest_id;
      target_status := transition_record.target_status;
      run_at := transition_record.run_at;
      group_id := affected_group_id;
      return next;
    end if;
  end loop;
end;
$$;

grant execute on function public.apply_due_scheduled_transitions(uuid)
to anon, authenticated;
