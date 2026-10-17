-- Local-only fixtures; the complete test transaction is rolled back.
begin;
do $$
<<verify_qq_profile_display>>
declare
  suffix text := lpad((floor(random()*10000000))::text,7,'0');
  bot_qq text; email_qq text; cached_qq text;
  bot_id uuid; email_id uuid; cached_id uuid;
  auth_id uuid := gen_random_uuid(); admin_id uuid := gen_random_uuid();
  group_id uuid; second_group uuid; job_id uuid; lease_id uuid; ticket record; display record;
  profile public.profiles%rowtype; preserved_id uuid;
  contest_id uuid; vote_id uuid; conflict_id uuid := gen_random_uuid();
begin
  bot_qq := '97'||suffix; email_qq := '98'||suffix; cached_qq := '99'||suffix;
  insert into auth.users(id,email,raw_user_meta_data) values(admin_id,admin_id::text||'@fixture.local','{}');
  update public.profiles set role='admin' where id=admin_id;
  insert into public.user_groups(name,join_code) values('QQ资料本地测试',gen_random_uuid()::text) returning id into group_id;
  insert into public.qq_group_sync_configs(user_group_id,qq_group_id,last_synced_at)
    values(group_id,'96'||suffix,now());

  bot_id := public.resolve_qq_profile(bot_qq,null,'QQ 昵称甲','https://other.example/not-qq.jpg');
  select * into profile from public.profiles where id=bot_id;
  if profile.qq_nickname is distinct from 'QQ 昵称甲' or profile.display_name is distinct from 'QQ 昵称甲'
    or profile.qq_avatar_url is distinct from 'https://q1.qlogo.cn/g?b=qq&nk='||bot_qq||'&s=100' then raise exception 'Bot display was not canonical'; end if;
  update public.profiles set role='admin' where id=bot_id;
  insert into public.contests(title) values('QQ资料更新保留历史投票') returning id into contest_id;
  insert into public.votes(contest_id,voter_id,payload) values(contest_id,bot_id,'{}') returning id into vote_id;
  preserved_id := public.resolve_qq_profile(bot_qq,auth_id);
  select * into profile from public.profiles where id=preserved_id;
  if preserved_id<>bot_id or profile.qq_nickname is distinct from 'QQ 昵称甲' or profile.role is distinct from 'admin' then
    raise exception 'email login replaced QQ identity/name/role'; end if;
  if not exists(select 1 from public.votes where id=vote_id and voter_id=bot_id) then raise exception 'identity presentation lost vote history'; end if;
  raise notice 'PASS Bot then email: same profile and role, QQ nickname and canonical avatar retained';

  -- Matching lists supply the QQ nickname, never the group-specific card.
  insert into public.qq_group_roster(user_group_id,qq_user_id,nickname,card,observed_at)
    values(group_id,cached_qq,'真正的 QQ 昵称','群内专用名片',clock_timestamp());
  select * into display from public.get_qq_profile_display(cached_qq);
  if display.nickname is distinct from '真正的 QQ 昵称' or exists(select 1 from public.profiles where qq_user_id=cached_qq) then
    raise exception 'cached display created an identity or used a group card'; end if;
  cached_id := public.resolve_qq_profile(cached_qq,gen_random_uuid());
  select * into profile from public.profiles where id=cached_id;
  if profile.display_name is distinct from '真正的 QQ 昵称' or profile.qq_nickname is distinct from '真正的 QQ 昵称' then raise exception 'verified email did not use cached QQ nickname'; end if;
  raise notice 'PASS first email login uses an observed QQ nickname, and display lookup never creates an account';

  email_id := public.resolve_qq_profile(email_qq,gen_random_uuid());
  select * into profile from public.profiles where id=email_id;
  if profile.qq_nickname is not null or profile.qq_avatar_url is distinct from 'https://q1.qlogo.cn/g?b=qq&nk='||email_qq||'&s=100' then
    raise exception 'email-only fallback invented a QQ nickname or omitted the QQ avatar'; end if;
  if public.resolve_qq_profile(email_qq,null,'后来取得的QQ昵称')<>email_id then raise exception 'Bot login split email account'; end if;
  select * into profile from public.profiles where id=email_id;
  if profile.display_name is distinct from '后来取得的QQ昵称' then raise exception 'Bot name was not adopted'; end if;
  raise notice 'PASS email then Bot: no invented nickname; later Bot data updates the existing identity';

  job_id := public.request_qq_group_sync(group_id,'96'||suffix,admin_id); lease_id:=gen_random_uuid();
  update public.qq_group_sync_jobs set status='running',started_at=clock_timestamp(),lease_id=verify_qq_profile_display.lease_id where id=job_id;
  perform public.finish_qq_group_sync_job(job_id,lease_id,jsonb_build_array(jsonb_build_object(
    'qq_user_id',email_qq,'nickname','拉表更新的QQ昵称','card','不能当昵称的群名片')));
  select * into profile from public.profiles where id=email_id;
  if profile.qq_nickname is distinct from '拉表更新的QQ昵称' or profile.display_name is distinct from '拉表更新的QQ昵称' then raise exception 'post-registration sync did not refresh QQ display'; end if;
  if not exists(select 1 from public.user_group_members where profile_id=email_id and user_group_id=group_id and expires_at='infinity') then
    raise exception 'display change damaged permanent roster membership'; end if;
  raise notice 'PASS registration before roster: sync updates QQ name and preserves permanent membership';

  -- A delayed snapshot must not roll back a more recent Bot identity update.
  job_id := public.request_qq_group_sync(group_id,'96'||suffix,admin_id); lease_id:=gen_random_uuid();
  update public.qq_group_sync_jobs set status='running',started_at=clock_timestamp()-interval '1 minute',lease_id=verify_qq_profile_display.lease_id where id=job_id;
  perform public.resolve_qq_profile(email_qq,null,'最新的Bot昵称');
  perform public.finish_qq_group_sync_job(job_id,lease_id,jsonb_build_array(jsonb_build_object(
    'qq_user_id',email_qq,'nickname','较旧的群名单昵称','card','')));
  select * into profile from public.profiles where id=email_id;
  if profile.qq_nickname is distinct from '最新的Bot昵称' then raise exception 'older snapshot overwrote a newer name'; end if;
  perform public.resolve_qq_profile(email_qq,gen_random_uuid());
  select * into profile from public.profiles where id=email_id;
  if profile.qq_nickname is distinct from '最新的Bot昵称' then raise exception 'email re-login restored a stale name'; end if;
  raise notice 'PASS stale snapshots and nickname-free logins do not overwrite newer QQ metadata';

  insert into public.profiles(id,display_name) values(conflict_id,'历史重复账号');
  begin
    perform public.resolve_qq_profile(bot_qq,conflict_id,'不能覆盖的昵称');
    raise exception 'historical identity conflict was accepted';
  exception when others then
    if sqlerrm<>'QQ_IDENTITY_CONFLICT' then raise; end if;
  end;
  if not exists(select 1 from public.votes where id=vote_id and voter_id=bot_id) then raise exception 'conflict handling changed votes'; end if;
  raise notice 'PASS historical identity conflict still preserves both accounts and original votes';

  if has_function_privilege('authenticated','public.get_qq_profile_display(text)','EXECUTE')
    or has_column_privilege('authenticated','public.profiles','qq_identity_updated_at','UPDATE') then
    raise exception 'identity metadata access was exposed to clients'; end if;
  raise notice 'PASS private display lookup and protected metadata writes';
end;
$$;
rollback;
