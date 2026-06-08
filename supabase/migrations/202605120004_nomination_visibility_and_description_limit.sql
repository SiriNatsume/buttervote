alter table public.contests
  add column if not exists show_existing_nominations boolean not null default false,
  add column if not exists candidate_description_max_length int;
