create table if not exists public.hall_of_fame_entries (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid references public.contests(id) on delete set null,
  event_title text not null check (char_length(trim(event_title)) between 1 and 120),
  winner_name text not null check (char_length(trim(winner_name)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 200),
  poster_path text not null unique,
  poster_mime_type text not null check (
    poster_mime_type in ('image/jpeg', 'image/png', 'image/webp')
  ),
  poster_size int not null check (poster_size > 0 and poster_size <= 20971520),
  sort_order int not null default 0 check (sort_order >= 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hall_of_fame_entries_sort_order_idx
  on public.hall_of_fame_entries(sort_order, created_at, id);

drop trigger if exists set_hall_of_fame_entries_updated_at
on public.hall_of_fame_entries;
create trigger set_hall_of_fame_entries_updated_at
before update on public.hall_of_fame_entries
for each row
execute function public.set_updated_at();

alter table public.hall_of_fame_entries enable row level security;

drop policy if exists "Anyone can view hall of fame entries"
on public.hall_of_fame_entries;
create policy "Anyone can view hall of fame entries"
on public.hall_of_fame_entries
for select
to anon, authenticated
using (true);

grant select on public.hall_of_fame_entries to anon, authenticated;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'hall-of-fame-posters',
  'hall-of-fame-posters',
  true,
  20971520,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Anyone can view hall of fame posters" on storage.objects;
create policy "Anyone can view hall of fame posters"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'hall-of-fame-posters');

drop policy if exists "Admins can manage hall of fame posters" on storage.objects;
create policy "Admins can manage hall of fame posters"
on storage.objects
for all
to authenticated
using (bucket_id = 'hall-of-fame-posters' and public.is_admin())
with check (bucket_id = 'hall-of-fame-posters' and public.is_admin());

create or replace function public.reorder_hall_of_fame_entries(
  p_entry_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total_count int;
  v_input_count int;
  v_distinct_count int;
begin
  select count(*)::int into v_total_count
  from public.hall_of_fame_entries;

  v_input_count := coalesce(cardinality(p_entry_ids), 0);

  select count(distinct entry_id)::int into v_distinct_count
  from unnest(coalesce(p_entry_ids, array[]::uuid[])) as ids(entry_id);

  if v_input_count <> v_total_count or v_distinct_count <> v_total_count then
    raise exception 'The supplied hall of fame order is incomplete or contains duplicates.';
  end if;

  if exists (
    select 1
    from unnest(coalesce(p_entry_ids, array[]::uuid[])) as ids(entry_id)
    left join public.hall_of_fame_entries entry on entry.id = ids.entry_id
    where entry.id is null
  ) then
    raise exception 'The supplied hall of fame order contains an unknown entry.';
  end if;

  update public.hall_of_fame_entries entry
  set sort_order = ordered.ordinality - 1
  from unnest(p_entry_ids) with ordinality as ordered(entry_id, ordinality)
  where entry.id = ordered.entry_id;
end;
$$;

revoke all on function public.reorder_hall_of_fame_entries(uuid[])
from public, anon, authenticated;
grant execute on function public.reorder_hall_of_fame_entries(uuid[])
to service_role;
