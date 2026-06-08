alter table public.contests
add column if not exists love_vote_enabled boolean not null default true;
