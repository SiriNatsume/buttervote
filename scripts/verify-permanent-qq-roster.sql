-- Run only against local Postgres. Fixtures and changes are rolled back.
begin;
do $$
declare
  admin_id uuid := gen_random_uuid(); member_id uuid := gen_random_uuid();
  late_id uuid := gen_random_uuid(); manual_id uuid := gen_random_uuid();
  group_id uuid; other_group_id uuid; job_id uuid; job public.qq_group_sync_jobs%rowtype;
  n integer; payload jsonb; contest_id uuid; vote_id uuid;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (admin_id, admin_id::text || '@fixture.local', '{}'),
    (member_id, member_id::text || '@fixture.local', '{}'),
    (manual_id, manual_id::text || '@fixture.local', '{}');
  insert into public.profiles(id,role,qq_user_id) values
    (admin_id,'admin','900001'), (member_id,'user','900002'), (manual_id,'user','900004')
    on conflict(id) do update set role=excluded.role, qq_user_id=excluded.qq_user_id;
  insert into public.user_groups(name,join_code) values('长期名单测试',gen_random_uuid()::text) returning id into group_id;
  insert into public.user_groups(name,join_code) values('其他用户组',gen_random_uuid()::text) returning id into other_group_id;
  insert into public.user_group_members(user_group_id,profile_id,source,expires_at)
    values(group_id,manual_id,'manual',now()+interval '1 day');
  insert into public.contests(title) values('名单移除保留历史投票测试') returning id into contest_id;
  insert into public.votes(contest_id,voter_id,payload) values(contest_id,member_id,'{}') returning id into vote_id;

  job_id := public.request_qq_group_sync(group_id,'910001',admin_id);
  update public.qq_group_sync_jobs set status='running', started_at=now(), lease_id=gen_random_uuid()
    where id=job_id returning * into job;
  if job.id is null then raise exception 'Isolate the queue before running this test'; end if;
  payload := '[{"qq_user_id":"900002","nickname":"已注册","card":""},
               {"qq_user_id":"900003","nickname":"待验证","card":""},
               {"qq_user_id":"900004","nickname":"手动成员","card":""}]';
  if not public.finish_qq_group_sync_job(job_id,job.lease_id,payload) then raise exception 'complete sync failed'; end if;
  if not exists(select 1 from public.user_group_members where user_group_id=group_id and profile_id=member_id
    and expires_at='infinity'::timestamptz and revoked_at is null and expires_at > now()+interval '100 years') then
    raise exception 'roster membership is not permanent'; end if;
  if not exists(select 1 from public.user_group_members where user_group_id=group_id and profile_id=manual_id
    and source='manual' and expires_at < 'infinity'::timestamptz) then raise exception 'manual decision overwritten'; end if;
  raise notice 'PASS permanent grants and manual overrides';

  -- A verified account can claim even an old retained list.
  update public.qq_group_sync_configs set last_synced_at=now()-interval '180 days' where user_group_id=group_id;
  insert into auth.users(id,email,raw_user_meta_data) values(late_id,late_id::text||'@fixture.local','{}');
  insert into public.profiles(id,role,qq_user_id) values(late_id,'user','900003')
    on conflict(id) do update set qq_user_id=excluded.qq_user_id;
  perform public.sync_qq_profile_memberships(late_id);
  if not exists(select 1 from public.user_group_members where user_group_id=group_id and profile_id=late_id
    and expires_at='infinity'::timestamptz and revoked_at is null) then raise exception 'old list could not grant permanent membership'; end if;
  raise notice 'PASS newly verified account matches retained lists without an age limit';

  job_id := public.request_qq_group_sync(group_id,'910001',admin_id);
  update public.qq_group_sync_jobs set status='running', started_at=now(), lease_id=gen_random_uuid()
    where id=job_id returning * into job;
  if not public.finish_qq_group_sync_job(job_id,job.lease_id,'[{"qq_user_id":"900004","nickname":"手动成员","card":""}]') then
    raise exception 'second sync failed'; end if;
  if (select count(*) from public.qq_group_roster where user_group_id=group_id) <> 3
    or not exists(select 1 from public.user_group_members where user_group_id=group_id and profile_id=member_id and revoked_at is null) then
    raise exception 'later snapshot automatically removed an old member'; end if;
  raise notice 'PASS later snapshots do not revoke absent members';

  -- A second group for the same QQ must survive removal from the first.
  insert into public.qq_group_sync_configs(user_group_id,qq_group_id,last_synced_at,member_count)
    values(other_group_id,'910002',now(),1);
  insert into public.qq_group_roster values(other_group_id,'900002','其他组','');
  perform public.sync_qq_profile_memberships(member_id);
  n := public.remove_qq_group_roster_members(group_id,admin_id,array['900002']);
  if n<>1 or not exists(select 1 from public.user_group_members where user_group_id=group_id and profile_id=member_id and revoked_at is not null)
    or not exists(select 1 from public.user_group_members where user_group_id=other_group_id and profile_id=member_id and revoked_at is null)
    or not exists(select 1 from public.votes where id=vote_id) then raise exception 'single removal scope or history failure'; end if;
  raise notice 'PASS single removal revokes only the selected group and preserves votes';

  job_id := public.request_qq_group_sync(group_id,'910001',admin_id);
  update public.qq_group_sync_jobs set status='running', started_at=now(), lease_id=gen_random_uuid()
    where id=job_id returning * into job;
  perform public.finish_qq_group_sync_job(job_id,job.lease_id,payload);
  perform public.sync_qq_profile_memberships(member_id,array[(select join_code from public.user_groups where id=group_id)]);
  if exists(select 1 from public.qq_group_roster where user_group_id=group_id and qq_user_id='900002')
    or not exists(select 1 from public.user_group_members where user_group_id=group_id and profile_id=member_id and revoked_at is not null) then
    raise exception 'removed entry was restored by sync or login'; end if;
  raise notice 'PASS removed matches do not return on Bot sync or login';

  begin
    perform public.remove_qq_group_roster_members(group_id,member_id,array['900003']);
    raise exception 'non-admin removal accepted';
  exception when others then
    if sqlerrm <> 'ADMIN_REQUIRED' then raise; end if;
  end;
  if has_function_privilege('authenticated','public.remove_qq_group_roster_members(uuid,uuid,text[],boolean)','EXECUTE')
    or has_table_privilege('anon','public.qq_group_roster_exclusions','SELECT') then raise exception 'public removal permissions exposed'; end if;
  raise notice 'PASS admin and service-role permission boundaries';

  -- Batch deletion also covers QQs who have not registered yet.
  job_id := public.request_qq_group_sync(group_id,'910001',admin_id);
  update public.qq_group_sync_jobs set status='running', started_at=now(), lease_id=gen_random_uuid()
    where id=job_id returning * into job;
  perform public.finish_qq_group_sync_job(job_id,job.lease_id,
    '[{"qq_user_id":"900005","nickname":"未注册","card":""}]');
  n := public.remove_qq_group_roster_members(group_id,admin_id,array['900003','900005','900005']);
  if n<>2 then raise exception 'batch removal did not deduplicate or remove expected entries'; end if;
  if not exists(select 1 from public.user_group_members where user_group_id=group_id and profile_id=late_id and revoked_at is not null)
    or not exists(select 1 from public.qq_group_roster_exclusions where user_group_id=group_id and qq_user_id='900005') then
    raise exception 'batch revocation/exclusion failure'; end if;
  raise notice 'PASS batch removal and unregistered QQ exclusions';

  -- Populate more than one page, then clear while a Bot job is in flight.
  select jsonb_agg(jsonb_build_object('qq_user_id',(920000+i)::text,'nickname','分页成员','card','')) into payload
    from generate_series(1,75) i;
  job_id := public.request_qq_group_sync(group_id,'910001',admin_id);
  update public.qq_group_sync_jobs set status='running', started_at=now(), lease_id=gen_random_uuid()
    where id=job_id returning * into job;
  perform public.finish_qq_group_sync_job(job_id,job.lease_id,payload);
  job_id := public.request_qq_group_sync(group_id,'910001',admin_id);
  update public.qq_group_sync_jobs set status='running', started_at=now(), lease_id=gen_random_uuid()
    where id=job_id returning * into job;
  n := public.remove_qq_group_roster_members(group_id,admin_id,'{}',true);
  if n<>76 or exists(select 1 from public.qq_group_roster where user_group_id=group_id)
    or (select member_count from public.qq_group_sync_configs where user_group_id=group_id)<>0 then
    raise exception 'remove-all did not clear every page'; end if;
  if public.finish_qq_group_sync_job(job_id,job.lease_id,payload) then raise exception 'stale Bot job refilled cleared list'; end if;
  if not exists(select 1 from public.user_group_members where user_group_id=group_id and profile_id=manual_id and revoked_at is null)
    or not exists(select 1 from public.votes where id=vote_id) then raise exception 'clear-all changed manual grants or votes'; end if;
  raise notice 'PASS clear-all spans pages, cancels stale jobs, and preserves manual grants/history';
end;
$$;
rollback;
