create or replace function public.enforce_scheduled_transition_limits()
returns trigger
language plpgsql
as $$
declare
  pending_count int;
begin
  if new.executed_at is null then
    select count(*)
      into pending_count
    from public.contest_scheduled_transitions
    where contest_id = new.contest_id
      and executed_at is null
      and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

    if pending_count >= 2 then
      raise exception 'each contest can have at most two pending scheduled transitions';
    end if;
  end if;

  return new;
end;
$$;
