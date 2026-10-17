-- QQ identity presentation is shared by Bot and verified QQ-email accounts.
-- Group cards are never used as the global QQ nickname.
alter table public.qq_group_roster add column observed_at timestamptz;
update public.qq_group_roster r set observed_at = coalesce(c.last_synced_at, now())
  from public.qq_group_sync_configs c where c.user_group_id = r.user_group_id;
alter table public.qq_group_roster alter column observed_at set default now(),
  alter column observed_at set not null;
alter table public.profiles add column qq_identity_updated_at timestamptz;
update public.profiles set qq_identity_updated_at = now()
  where nullif(btrim(qq_nickname), '') is not null;

create function public.get_qq_profile_display(p_qq_user_id text)
returns table(nickname text, avatar_url text, observed_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select
    case when roster.nickname is not null and (cached.nickname is null
      or roster.observed_at > coalesce(cached.observed_at, '-infinity'::timestamptz))
      then roster.nickname else cached.nickname end,
    case when p_qq_user_id ~ '^[1-9][0-9]{4,11}$'
      then 'https://q1.qlogo.cn/g?b=qq&nk=' || p_qq_user_id || '&s=100'
      else nullif(btrim(cached.avatar_url), '') end,
    case when roster.nickname is not null and (cached.nickname is null
      or roster.observed_at > coalesce(cached.observed_at, '-infinity'::timestamptz))
      then roster.observed_at else cached.observed_at end
  from (select 1) seed
  left join lateral (
    select nullif(btrim(p.qq_nickname), '') nickname, p.qq_avatar_url avatar_url,
      p.qq_identity_updated_at observed_at
    from public.profiles p where p.qq_user_id = p_qq_user_id
  ) cached on true
  left join lateral (
    select nullif(btrim(r.nickname), '') nickname, r.observed_at
    from public.qq_group_roster r where r.qq_user_id = p_qq_user_id
      and nullif(btrim(r.nickname), '') is not null
    order by r.observed_at desc, r.user_group_id limit 1
  ) roster on true;
$$;
revoke all on function public.get_qq_profile_display(text) from public, anon, authenticated;
grant execute on function public.get_qq_profile_display(text) to service_role;

create or replace function public.resolve_qq_profile(
  p_qq_user_id text, p_verified_auth_user_id uuid default null,
  p_nickname text default null, p_avatar_url text default null
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  existing public.profiles%rowtype; legacy public.profiles%rowtype;
  cached record; result_id uuid; chosen_nickname text; chosen_avatar text; chosen_at timestamptz;
begin
  if p_qq_user_id is null or length(p_qq_user_id) not between 1 and 128 then raise exception 'INVALID_QQ_ID'; end if;
  perform pg_advisory_xact_lock(hashtextextended('qq-profile:' || p_qq_user_id, 0));
  select * into existing from public.profiles where qq_user_id = p_qq_user_id;
  if p_verified_auth_user_id is not null then
    if p_qq_user_id !~ '^[1-9][0-9]{4,11}$' then raise exception 'INVALID_QQ_ID'; end if;
    select * into legacy from public.profiles where id = p_verified_auth_user_id;
    if legacy.id is not null and (
      (legacy.qq_user_id is not null and legacy.qq_user_id <> p_qq_user_id)
      or (existing.id is not null and existing.id <> legacy.id)
    ) then raise exception 'QQ_IDENTITY_CONFLICT'; end if;
  end if;
  select * into cached from public.get_qq_profile_display(p_qq_user_id);
  chosen_nickname := coalesce(nullif(btrim(p_nickname), ''), cached.nickname, nullif(btrim(legacy.qq_nickname), ''));
  chosen_avatar := case when p_qq_user_id ~ '^[1-9][0-9]{4,11}$' then cached.avatar_url
    else coalesce(nullif(btrim(p_avatar_url), ''), cached.avatar_url, legacy.qq_avatar_url) end;
  chosen_at := case when nullif(btrim(p_nickname), '') is not null then clock_timestamp()
    else coalesce(cached.observed_at, legacy.qq_identity_updated_at) end;
  result_id := coalesce(existing.id, legacy.id, gen_random_uuid());
  if existing.id is null and legacy.id is null then
    insert into public.profiles(id,qq_user_id,qq_nickname,qq_avatar_url,display_name,email,login_provider,qq_identity_updated_at)
    values(result_id,p_qq_user_id,chosen_nickname,chosen_avatar,
      coalesce(chosen_nickname,'QQ 用户 ' || right(p_qq_user_id,4)),
      case when p_verified_auth_user_id is not null then p_qq_user_id || '@qq.com' end,
      case when p_verified_auth_user_id is not null then 'qq_email' else 'qq_bot' end,chosen_at);
  else
    update public.profiles p set qq_user_id = p_qq_user_id,
      qq_nickname = case when chosen_nickname is not null
        and coalesce(chosen_at,'-infinity') >= coalesce(p.qq_identity_updated_at,'-infinity')
        then chosen_nickname else p.qq_nickname end,
      display_name = case when chosen_nickname is not null
        and coalesce(chosen_at,'-infinity') >= coalesce(p.qq_identity_updated_at,'-infinity')
        then chosen_nickname else p.display_name end,
      qq_avatar_url = coalesce(chosen_avatar,p.qq_avatar_url),
      qq_identity_updated_at = greatest(chosen_at,p.qq_identity_updated_at),
      email = case when p_verified_auth_user_id is not null then p_qq_user_id || '@qq.com' else p.email end
    where p.id = result_id;
  end if;
  return result_id;
end;
$$;

-- Reuse already observed QQ names and repair numeric-QQ avatars for existing
-- accounts. Keep profile IDs, roles, memberships, and votes unchanged.
with displays as materialized (
  select p.id,d.* from public.profiles p
  cross join lateral public.get_qq_profile_display(p.qq_user_id) d
  where p.qq_user_id is not null
)
update public.profiles p set qq_nickname = coalesce(d.nickname,p.qq_nickname),
  display_name = coalesce(d.nickname,p.display_name),
  qq_avatar_url = coalesce(d.avatar_url,p.qq_avatar_url),
  qq_identity_updated_at = greatest(d.observed_at,p.qq_identity_updated_at)
from displays d where p.id = d.id;

create or replace function public.finish_qq_group_sync_job(
  p_job_id uuid, p_lease_id uuid, p_members jsonb default null,
  p_error text default null, p_days integer default 7
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare job public.qq_group_sync_jobs%rowtype; target_group uuid; n integer; incoming record;
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
  insert into public.qq_group_roster as roster(user_group_id, qq_user_id, nickname, card, observed_at)
    select job.user_group_id, r.qq_user_id, r.nickname, r.card, job.started_at
    from jsonb_to_recordset(p_members) as r(qq_user_id text, nickname text, card text)
    where not exists(select 1 from public.qq_group_roster_exclusions e
      where e.user_group_id = job.user_group_id and e.qq_user_id = r.qq_user_id)
    on conflict(user_group_id, qq_user_id) do update set nickname = excluded.nickname, card = excluded.card, observed_at = excluded.observed_at;
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

  -- Update identity presentation from this actual observation, not retained
  -- matching rows or group cards. Lock profiles in stable ID order across jobs.
  for incoming in
    select p.id, btrim(r.nickname) nickname from public.profiles p
    join jsonb_to_recordset(p_members) as r(qq_user_id text,nickname text,card text)
      on r.qq_user_id = p.qq_user_id
    where nullif(btrim(r.nickname),'') is not null order by p.id
  loop
    update public.profiles p set qq_nickname = incoming.nickname,
      display_name = incoming.nickname,
      qq_avatar_url = 'https://q1.qlogo.cn/g?b=qq&nk=' || p.qq_user_id || '&s=100',
      qq_identity_updated_at = job.started_at
    where p.id = incoming.id
      and coalesce(p.qq_identity_updated_at,'-infinity'::timestamptz) <= job.started_at;
  end loop;

  update public.qq_group_sync_jobs set status = 'succeeded', member_count = n, finished_at = now()
    where id = p_job_id;
  return true;
end;
$$;

