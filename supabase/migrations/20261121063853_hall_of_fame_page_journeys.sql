-- Keep existing group journeys unchanged. Page journeys follow the page ID;
-- public rendering resolves its current slug and visibility on each request.
alter table public.hall_of_fame_entries
  add column page_id uuid references public.site_pages(id) on delete set null,
  add constraint hall_of_fame_entries_journey_target_check
    check (contest_group_id is null or page_id is null);

create index hall_of_fame_entries_page_id_idx
  on public.hall_of_fame_entries(page_id)
  where page_id is not null;

comment on column public.hall_of_fame_entries.page_id is
  'Optional Markdown champion journey; only public pages get a public link.';

notify pgrst, 'reload schema';
