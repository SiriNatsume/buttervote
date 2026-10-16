-- QQ email is an authentication method for the existing QQ profile, not a
-- second voter identity. No existing profiles, votes or nominations are moved.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if lower(new.email) ~ '^[1-9][0-9]{4,11}@qq[.]com$' then
    return new; -- only create/claim the profile AFTER successful email OTP
  end if;
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

create or replace function public.resolve_qq_profile(
  p_qq_user_id text, p_verified_auth_user_id uuid default null,
  p_nickname text default null, p_avatar_url text default null
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  existing public.profiles%rowtype;
  legacy public.profiles%rowtype;
  result_id uuid;
begin
  if p_qq_user_id is null or length(p_qq_user_id) not between 1 and 128 then
    raise exception 'INVALID_QQ_ID';
  end if;
  -- Serializes bot-first, email-first and simultaneous first logins.
  perform pg_advisory_xact_lock(hashtextextended('qq-profile:' || p_qq_user_id, 0));
  select * into existing from public.profiles where qq_user_id = p_qq_user_id;
  if p_verified_auth_user_id is not null then
    if p_qq_user_id !~ '^[1-9][0-9]{4,11}$' then raise exception 'INVALID_QQ_ID'; end if;
    select * into legacy from public.profiles where id = p_verified_auth_user_id;
    if legacy.id is not null and (
      (legacy.qq_user_id is not null and legacy.qq_user_id <> p_qq_user_id)
      or (existing.id is not null and existing.id <> legacy.id)
    ) then
      -- Historical duplicate accounts require a deliberate reconciliation.
      -- Never discard votes or silently give the user a second voter profile.
      raise exception 'QQ_IDENTITY_CONFLICT';
    end if;
  end if;
  result_id := coalesce(existing.id, legacy.id, gen_random_uuid());
  if existing.id is null and legacy.id is null then
    insert into public.profiles (id, qq_user_id, qq_nickname, qq_avatar_url,
      display_name, email, login_provider)
    values (result_id, p_qq_user_id, nullif(p_nickname, ''), nullif(p_avatar_url, ''),
      coalesce(nullif(p_nickname, ''), 'QQ 用户 ' || right(p_qq_user_id, 4)),
      case when p_verified_auth_user_id is not null then p_qq_user_id || '@qq.com' end,
      case when p_verified_auth_user_id is not null then 'qq_email' else 'qq_bot' end);
  else
    update public.profiles set qq_user_id = p_qq_user_id,
      qq_nickname = coalesce(nullif(p_nickname, ''), qq_nickname),
      qq_avatar_url = coalesce(nullif(p_avatar_url, ''), qq_avatar_url),
      email = case when p_verified_auth_user_id is not null
        then p_qq_user_id || '@qq.com' else email end
    where id = result_id;
  end if;
  return result_id;
end;
$$;

create table public.qq_email_rate_limits (
  key text primary key,
  window_started_at timestamptz not null default now(),
  attempts integer not null default 1
);
create index qq_email_rate_limits_expiry_idx on public.qq_email_rate_limits(window_started_at);
create function public.take_qq_email_rate_limit(p_key text, p_limit integer, p_seconds integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare n integer;
begin
  delete from public.qq_email_rate_limits where window_started_at < now() - interval '1 day';
  insert into public.qq_email_rate_limits as r (key) values (p_key)
  on conflict (key) do update set
    attempts = case when r.window_started_at <= now() - make_interval(secs => p_seconds)
      then 1 else r.attempts + 1 end,
    window_started_at = case when r.window_started_at <= now() - make_interval(secs => p_seconds)
      then now() else r.window_started_at end
  returning attempts into n;
  return n <= p_limit;
end;
$$;

create table public.qq_group_sync_configs (
  user_group_id uuid primary key references public.user_groups(id) on delete cascade,
  qq_group_id text not null unique check (qq_group_id ~ '^[1-9][0-9]{4,11}$'),
  last_synced_at timestamptz,
  member_count integer not null default 0
);
create table public.qq_group_roster (
  user_group_id uuid not null references public.qq_group_sync_configs(user_group_id) on delete cascade,
  qq_user_id text not null check (qq_user_id ~ '^[1-9][0-9]{4,11}$'),
  nickname text not null default '',
  card text not null default '',
  primary key (user_group_id, qq_user_id)
);
create index qq_group_roster_qq_idx on public.qq_group_roster(qq_user_id);
create table public.qq_group_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  user_group_id uuid not null references public.qq_group_sync_configs(user_group_id) on delete cascade,
  qq_group_id text not null,
  requested_by uuid not null references public.profiles(id),
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed')),
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  lease_id uuid,
  error text,
  member_count integer
);
create unique index qq_group_sync_active_job on public.qq_group_sync_jobs(user_group_id)
  where status in ('queued', 'running');
create index qq_group_sync_jobs_requested_idx on public.qq_group_sync_jobs(requested_at);

-- An explicitly revoked member must never be restored by a background sync.
-- Existing manual revocations are retained as manual decisions.
update public.user_group_members set source = 'manual' where revoked_at is not null;

create function public.sync_qq_profile_memberships(
  p_profile_id uuid, p_join_codes text[] default '{}', p_days integer default 7
) returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_days not between 1 and 90 then raise exception 'INVALID_MEMBERSHIP_DAYS'; end if;
  insert into public.user_group_members as m
    (user_group_id, profile_id, source, last_verified_at, expires_at, revoked_at)
  select g.id, p_profile_id, 'qq_ticket', now(), now() + make_interval(days => p_days), null
  from public.user_groups g where g.join_code = any(p_join_codes)
  on conflict (user_group_id, profile_id) do update set
    source = excluded.source, last_verified_at = excluded.last_verified_at,
    expires_at = excluded.expires_at, revoked_at = null
  where m.source <> 'manual';

  insert into public.user_group_members as m
    (user_group_id, profile_id, source, last_verified_at, expires_at, revoked_at)
  select r.user_group_id, p.id, 'qq_roster', c.last_synced_at,
    c.last_synced_at + make_interval(days => p_days), null
  from public.qq_group_roster r
  join public.qq_group_sync_configs c using (user_group_id)
  join public.profiles p on p.qq_user_id = r.qq_user_id
  where p.id = p_profile_id and c.last_synced_at + make_interval(days => p_days) > now()
  on conflict (user_group_id, profile_id) do update set
    source = excluded.source, last_verified_at = excluded.last_verified_at,
    expires_at = excluded.expires_at, revoked_at = null
  where m.source <> 'manual' and coalesce(m.last_verified_at, '-infinity') <= excluded.last_verified_at;
end;
$$;

create function public.request_qq_group_sync(p_user_group_id uuid, p_qq_group_id text, p_admin_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare current_group text; result_id uuid;
begin
  if not exists(select 1 from public.profiles where id = p_admin_id and role = 'admin') then
    raise exception 'ADMIN_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('qq-group:' || p_user_group_id::text, 0));
  select qq_group_id into current_group from public.qq_group_sync_configs where user_group_id = p_user_group_id;
  if current_group is not null and current_group <> p_qq_group_id then
    raise exception 'QQ_GROUP_ALREADY_BOUND'; -- do not transfer old members to a different group
  end if;
  insert into public.qq_group_sync_configs(user_group_id, qq_group_id)
    values(p_user_group_id, p_qq_group_id) on conflict(user_group_id) do nothing;
  insert into public.qq_group_sync_jobs(user_group_id, qq_group_id, requested_by)
    values(p_user_group_id, p_qq_group_id, p_admin_id)
    on conflict(user_group_id) where status in ('queued','running') do nothing
    returning id into result_id;
  if result_id is null then
    select id into result_id from public.qq_group_sync_jobs
    where user_group_id = p_user_group_id and status in ('queued','running');
  end if;
  return result_id;
end;
$$;

create function public.claim_qq_group_sync_job()
returns setof public.qq_group_sync_jobs language plpgsql security invoker set search_path = '' as $$
begin
  return query update public.qq_group_sync_jobs set status = 'running',
    started_at = now(), lease_id = gen_random_uuid(), error = null
  where id = (select id from public.qq_group_sync_jobs
    where status = 'queued' or (status = 'running' and started_at < now() - interval '5 minutes')
    order by requested_at for update skip locked limit 1)
  returning *;
end;
$$;

create function public.finish_qq_group_sync_job(
  p_job_id uuid, p_lease_id uuid, p_members jsonb default null,
  p_error text default null, p_days integer default 7
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare job public.qq_group_sync_jobs%rowtype; n integer;
begin
  select * into job from public.qq_group_sync_jobs where id = p_job_id for update;
  if job.id is null or job.status <> 'running' or job.lease_id is distinct from p_lease_id
    or job.started_at < now() - interval '5 minutes' then return false; end if;
  if p_error is not null then
    update public.qq_group_sync_jobs set status = 'failed', error = left(p_error, 300), finished_at = now()
      where id = p_job_id;
    return true; -- failed/partial fetch leaves the last good roster untouched
  end if;
  if p_days not between 1 and 90 or p_members is null or jsonb_typeof(p_members) <> 'array' then
    raise exception 'INVALID_ROSTER';
  end if;
  n := jsonb_array_length(p_members);
  if n < 1 or n > 10000 then raise exception 'INVALID_ROSTER_SIZE'; end if;
  if exists(select 1 from jsonb_to_recordset(p_members) as r(qq_user_id text, nickname text, card text)
    where qq_user_id is null or qq_user_id !~ '^[1-9][0-9]{4,11}$'
      or length(nickname) > 120 or length(card) > 120) then raise exception 'INVALID_ROSTER'; end if;
  if (select count(distinct r->>'qq_user_id') from jsonb_array_elements(p_members) r) <> n then
    raise exception 'DUPLICATE_ROSTER_MEMBER';
  end if;

  delete from public.qq_group_roster where user_group_id = job.user_group_id;
  insert into public.qq_group_roster(user_group_id, qq_user_id, nickname, card)
    select job.user_group_id, r.qq_user_id, coalesce(r.nickname,''), coalesce(r.card,'')
    from jsonb_to_recordset(p_members) as r(qq_user_id text, nickname text, card text);
  update public.qq_group_sync_configs set last_synced_at = job.started_at, member_count = n
    where user_group_id = job.user_group_id;

  insert into public.user_group_members as m
    (user_group_id, profile_id, source, last_verified_at, expires_at, revoked_at)
  select job.user_group_id, p.id, 'qq_roster', job.started_at,
    job.started_at + make_interval(days => p_days), null
  from public.qq_group_roster r join public.profiles p on p.qq_user_id = r.qq_user_id
  where r.user_group_id = job.user_group_id
  on conflict(user_group_id, profile_id) do update set
    source = excluded.source, last_verified_at = excluded.last_verified_at,
    expires_at = excluded.expires_at, revoked_at = null
  where m.source <> 'manual' and coalesce(m.last_verified_at, '-infinity') <= excluded.last_verified_at;

  update public.user_group_members m set source = 'qq_roster', revoked_at = now(), expires_at = now()
  from public.profiles p where m.profile_id = p.id and m.user_group_id = job.user_group_id
    and m.source <> 'manual' and p.qq_user_id is not null
    and coalesce(m.last_verified_at, '-infinity') <= job.started_at
    and not exists(select 1 from public.qq_group_roster r
      where r.user_group_id = job.user_group_id and r.qq_user_id = p.qq_user_id);
  update public.qq_group_sync_jobs set status = 'succeeded', member_count = n, finished_at = now()
    where id = p_job_id;
  return true;
end;
$$;

alter table public.qq_email_rate_limits enable row level security;
alter table public.qq_group_sync_configs enable row level security;
alter table public.qq_group_roster enable row level security;
alter table public.qq_group_sync_jobs enable row level security;
revoke all on public.qq_email_rate_limits, public.qq_group_sync_configs,
  public.qq_group_roster, public.qq_group_sync_jobs from public, anon, authenticated;
grant all on public.qq_email_rate_limits, public.qq_group_sync_configs,
  public.qq_group_roster, public.qq_group_sync_jobs to service_role;
revoke all on function public.resolve_qq_profile(text,uuid,text,text),
  public.take_qq_email_rate_limit(text,integer,integer),
  public.sync_qq_profile_memberships(uuid,text[],integer),
  public.request_qq_group_sync(uuid,text,uuid), public.claim_qq_group_sync_job(),
  public.finish_qq_group_sync_job(uuid,uuid,jsonb,text,integer) from public, anon, authenticated;
grant execute on function public.resolve_qq_profile(text,uuid,text,text),
  public.take_qq_email_rate_limit(text,integer,integer),
  public.sync_qq_profile_memberships(uuid,text[],integer),
  public.request_qq_group_sync(uuid,text,uuid), public.claim_qq_group_sync_job(),
  public.finish_qq_group_sync_job(uuid,uuid,jsonb,text,integer) to service_role;
