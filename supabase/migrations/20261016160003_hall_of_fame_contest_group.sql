alter table public.hall_of_fame_entries
  add column contest_group_id uuid
  references public.contest_groups(id) on delete set null;

create index hall_of_fame_entries_contest_group_id_idx
  on public.hall_of_fame_entries(contest_group_id)
  where contest_group_id is not null;

comment on column public.hall_of_fame_entries.contest_group_id is
  'Optional contest group overview linked from the champion journey button.';
