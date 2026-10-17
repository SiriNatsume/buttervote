-- Matching-list membership is permanent. Removals are explicit administrator
-- decisions and survive later Bot snapshots, including for unregistered QQs.
create table public.qq_group_roster_exclusions (
  user_group_id uuid not null references public.qq_group_sync_configs(user_group_id) on delete cascade,
  qq_user_id text not null check (qq_user_id ~ '^[1-9][0-9]{4,11}$'),
  removed_by uuid references public.profiles(id) on delete set null,
  removed_at timestamptz not null default now(),
  primary key (user_group_id, qq_user_id)
);
alter table public.qq_group_roster_exclusions enable row level security;
revoke all on public.qq_group_roster_exclusions from public, anon, authenticated;
grant all on public.qq_group_roster_exclusions to service_role;

create or replace function public.sync_qq_profile_memberships(
  p_profile_id uuid, p_join_codes text[] default '{}', p_days integer default 7
) returns void language plpgsql security invoker set search_path = '' as $$
declare target_group uuid;
begin
  if p_days not between 1 and 90 then raise exception 'INVALID_MEMBERSHIP_DAYS'; end if;
  -- Use the same group lock as admin removals and Bot completion. Login must
  -- not grant a membership from a list concurrently being removed.
  for target_group in
    select g.id from public.user_groups g where g.join_code = any(p_join_codes)
    union
    select r.user_group_id from public.qq_group_roster r
      join public.profiles p on p.qq_user_id = r.qq_user_id where p.id = p_profile_id
    order by 1
  loop
    perform pg_advisory_xact_lock(hashtextextended('qq-group:' || target_group::text, 0));
  end loop;

  insert into public.user_group_members as m
    (user_group_id, profile_id, source, last_verified_at, expires_at, revoked_at)
  select g.id, p_profile_id, 'qq_ticket', now(), now() + make_interval(days => p_days), null
  from public.user_groups g join public.profiles p on p.id = p_profile_id
  where g.join_code = any(p_join_codes) and not exists (
    select 1 from public.qq_group_roster_exclusions e
    where e.user_group_id = g.id and e.qq_user_id = p.qq_user_id
  )
  on conflict (user_group_id, profile_id) do update set
    source = excluded.source, last_verified_at = excluded.last_verified_at,
    expires_at = excluded.expires_at, revoked_at = null
  where m.source <> 'manual' and m.expires_at is distinct from 'infinity'::timestamptz;

  insert into public.user_group_members as m
    (user_group_id, profile_id, source, last_verified_at, expires_at, revoked_at)
  select r.user_group_id, p.id, 'qq_roster', c.last_synced_at, 'infinity'::timestamptz, null
  from public.qq_group_roster r
  join public.qq_group_sync_configs c using (user_group_id)
  join public.profiles p on p.qq_user_id = r.qq_user_id
  where p.id = p_profile_id and c.last_synced_at is not null
  for share of r
  on conflict (user_group_id, profile_id) do update set
    source = excluded.source, last_verified_at = excluded.last_verified_at,
    expires_at = excluded.expires_at, revoked_at = null
  where m.source <> 'manual';
end;
$$;

create or replace function public.finish_qq_group_sync_job(
  p_job_id uuid, p_lease_id uuid, p_members jsonb default null,
  p_error text default null, p_days integer default 7
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare job public.qq_group_sync_jobs%rowtype; target_group uuid; n integer;
begin
  select user_group_id into target_group from public.qq_group_sync_jobs where id = p_job_id;
  if target_group is null then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('qq-group:' || target_group::text, 0));
  select * into job from public.qq_group_sync_jobs where id = p_job_id for update;
  if job.id is null or job.status <> 'running' or job.lease_id is distinct from p_lease_id
    or job.started_at < now() - interval '5 minutes' then return false; end if;
  if p_error is not null then
    update public.qq_group_sync_jobs set status = 'failed', error = left(p_error, 300), finished_at = now()
      where id = p_job_id;
    return true;
  end if;
  if p_days not between 1 and 90 or p_members is null or jsonb_typeof(p_members) <> 'array' then
    raise exception 'INVALID_ROSTER';
  end if;
  n := jsonb_array_length(p_members);
  if n < 1 or n > 10000 then raise exception 'INVALID_ROSTER_SIZE'; end if;
  if exists(select 1 from jsonb_to_recordset(p_members) as r(qq_user_id text, nickname text, card text)
    where qq_user_id is null or qq_user_id !~ '^[1-9][0-9]{4,11}$'
      or nickname is null or card is null or length(nickname) > 120 or length(card) > 120) then
    raise exception 'INVALID_ROSTER';
  end if;
  if (select count(distinct r->>'qq_user_id') from jsonb_array_elements(p_members) r) <> n then
    raise exception 'DUPLICATE_ROSTER_MEMBER';
  end if;

  -- Keep previously matched members even if absent from a later QQ snapshot.
  -- Explicitly removed QQs remain excluded until an administrator changes them.
  insert into public.qq_group_roster as roster(user_group_id, qq_user_id, nickname, card)
    select job.user_group_id, r.qq_user_id, r.nickname, r.card
    from jsonb_to_recordset(p_members) as r(qq_user_id text, nickname text, card text)
    where not exists(select 1 from public.qq_group_roster_exclusions e
      where e.user_group_id = job.user_group_id and e.qq_user_id = r.qq_user_id)
    on conflict(user_group_id, qq_user_id) do update set nickname = excluded.nickname, card = excluded.card;
  update public.qq_group_sync_configs set last_synced_at = job.started_at,
    member_count = (select count(*) from public.qq_group_roster where user_group_id = job.user_group_id)
    where user_group_id = job.user_group_id;

  insert into public.user_group_members as m
    (user_group_id, profile_id, source, last_verified_at, expires_at, revoked_at)
  select job.user_group_id, p.id, 'qq_roster', job.started_at, 'infinity'::timestamptz, null
  from public.qq_group_roster r join public.profiles p on p.qq_user_id = r.qq_user_id
  where r.user_group_id = job.user_group_id
  on conflict(user_group_id, profile_id) do update set
    source = excluded.source, last_verified_at = excluded.last_verified_at,
    expires_at = excluded.expires_at, revoked_at = null
  where m.source <> 'manual';

  update public.qq_group_sync_jobs set status = 'succeeded', member_count = n, finished_at = now()
    where id = p_job_id;
  return true;
end;
$$;

create function public.remove_qq_group_roster_members(
  p_user_group_id uuid, p_admin_id uuid,
  p_qq_user_ids text[] default '{}', p_remove_all boolean default false
) returns integer language plpgsql security invoker set search_path = '' as $$
declare removed_ids text[]; removed_count integer;
begin
  if not exists(select 1 from public.profiles where id = p_admin_id and role = 'admin') then
    raise exception 'ADMIN_REQUIRED';
  end if;
  if p_remove_all is null or p_qq_user_ids is null or cardinality(p_qq_user_ids) > 10000
    or (p_remove_all and cardinality(p_qq_user_ids) <> 0)
    or (not p_remove_all and cardinality(p_qq_user_ids) = 0)
    or exists(select 1 from unnest(p_qq_user_ids) q where q is null or q !~ '^[1-9][0-9]{4,11}$') then
    raise exception 'INVALID_ROSTER_REMOVAL';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('qq-group:' || p_user_group_id::text, 0));
  select coalesce(array_agg(qq_user_id), '{}') into removed_ids from public.qq_group_roster
    where user_group_id = p_user_group_id and (p_remove_all or qq_user_id = any(p_qq_user_ids));
  removed_count := cardinality(removed_ids);

  insert into public.qq_group_roster_exclusions(user_group_id, qq_user_id, removed_by)
    select p_user_group_id, q, p_admin_id from unnest(removed_ids) q
    on conflict(user_group_id, qq_user_id) do update set removed_by = excluded.removed_by, removed_at = now();
  delete from public.qq_group_roster where user_group_id = p_user_group_id and qq_user_id = any(removed_ids);
  update public.user_group_members m set source = 'manual', revoked_at = now(), expires_at = now()
    from public.profiles p where m.profile_id = p.id and m.user_group_id = p_user_group_id
      and m.source = 'qq_roster' and p.qq_user_id = any(removed_ids);
  update public.qq_group_sync_configs
    set member_count = (select count(*) from public.qq_group_roster where user_group_id = p_user_group_id)
    where user_group_id = p_user_group_id;
  if removed_count > 0 or p_remove_all then
    -- An in-flight snapshot must not refill the list after the admin removed it.
    update public.qq_group_sync_jobs set status = 'failed', finished_at = now(),
      error = '管理员已移除匹配列表，本次同步已取消。'
      where user_group_id = p_user_group_id and status in ('queued', 'running');
  end if;
  return removed_count;
end;
$$;
revoke all on function public.remove_qq_group_roster_members(uuid,uuid,text[],boolean) from public, anon, authenticated;
grant execute on function public.remove_qq_group_roster_members(uuid,uuid,text[],boolean) to service_role;

-- Existing verified profiles in retained lists receive the same permanent
-- grant. Preserve every explicit manual decision, including revocations.
insert into public.user_group_members as m
  (user_group_id, profile_id, source, last_verified_at, expires_at, revoked_at)
select r.user_group_id, p.id, 'qq_roster', c.last_synced_at, 'infinity'::timestamptz, null
from public.qq_group_roster r join public.qq_group_sync_configs c using(user_group_id)
join public.profiles p on p.qq_user_id = r.qq_user_id
where c.last_synced_at is not null
on conflict(user_group_id,profile_id) do update set
  source = excluded.source, last_verified_at = excluded.last_verified_at,
  expires_at = excluded.expires_at, revoked_at = null
where m.source <> 'manual' and m.revoked_at is null;
