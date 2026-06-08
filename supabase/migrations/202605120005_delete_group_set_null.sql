do $$
declare
  constraint_name text;
begin
  if to_regclass('public.contests') is not null
    and to_regclass('public.contest_groups') is not null then
    for constraint_name in
      select conname
      from pg_constraint
      where conrelid = 'public.contests'::regclass
        and confrelid = 'public.contest_groups'::regclass
        and contype = 'f'
    loop
      execute format('alter table public.contests drop constraint %I', constraint_name);
    end loop;

    update public.contests c
    set group_id = null
    where c.group_id is not null
      and not exists (
        select 1
        from public.contest_groups g
        where g.id = c.group_id
      );

    alter table public.contests
      drop constraint if exists contests_group_id_fkey;

    alter table public.contests
      add constraint contests_group_id_fkey
      foreign key (group_id)
      references public.contest_groups(id)
      on delete set null;
  end if;
end $$;

do $$
declare
  constraint_name text;
begin
  if to_regclass('public.love_vote_allocations') is not null
    and to_regclass('public.contest_groups') is not null then
    alter table public.love_vote_allocations
      alter column group_id drop not null;

    for constraint_name in
      select conname
      from pg_constraint
      where conrelid = 'public.love_vote_allocations'::regclass
        and confrelid = 'public.contest_groups'::regclass
        and contype = 'f'
    loop
      execute format(
        'alter table public.love_vote_allocations drop constraint %I',
        constraint_name
      );
    end loop;

    update public.love_vote_allocations l
    set group_id = null
    where l.group_id is not null
      and not exists (
        select 1
        from public.contest_groups g
        where g.id = l.group_id
      );

    alter table public.love_vote_allocations
      drop constraint if exists love_vote_allocations_group_id_fkey;

    alter table public.love_vote_allocations
      add constraint love_vote_allocations_group_id_fkey
      foreign key (group_id)
      references public.contest_groups(id)
      on delete set null;
  end if;
end $$;
