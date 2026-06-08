alter table public.contests
  add column if not exists require_exact_choices boolean not null default false;
