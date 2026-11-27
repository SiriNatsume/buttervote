-- Run against a local Supabase database after the both_support_votes migration.
-- All fixtures, including auth users, are rolled back.
begin;
create temporary table both_support_test_scope (id uuid);
create function pg_temp.expect_both_support_error(p_sql text, p_message text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_message in sqlerrm) = 0 then
      raise exception 'Unexpected error: %, expected: %', sqlerrm, p_message;
    end if;
    return;
  end;
  raise exception 'Expected rejection: %', p_message;
end;
$$;

do $$
declare
  g uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  c2 uuid := gen_random_uuid();
  c3 uuid := gen_random_uuid();
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  a2 uuid := gen_random_uuid(); b2 uuid := gen_random_uuid();
  a3 uuid := gen_random_uuid(); b3 uuid := gen_random_uuid();
  extra uuid := gen_random_uuid();
  users uuid[] := array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  uid uuid; normal_vote uuid; both_vote uuid; group_vote uuid;
  pair jsonb; pair2 jsonb; pair3 jsonb; requests jsonb;
  row_a record; row_b record; n int; ug uuid := gen_random_uuid();
begin
  foreach uid in array users loop
    insert into auth.users(id, email) values(uid, uid::text || '@both-support.local');
  end loop;
  insert into public.contest_groups(id, name, love_vote_quota, love_vote_weight)
    values(g, 'Both support verification', 4, 3);
  insert into public.contests(id, title, group_id, status, vote_type, max_choices, live_results_enabled)
    values(c, 'Both support primary', g, 'voting', 'single', 1, true),
      (c2, 'Both support group', g, 'voting', 'single', 1, true),
      (c3, 'Both support disabled', g, 'voting', 'single', 1, true);
  assert (select bool_and(both_support_enabled) from public.contests where id in (c,c2,c3)), 'Default must be enabled';
  insert into public.candidates(id, contest_id, name) values
    (a,c,'A'), (b,c,'B'), (a2,c2,'A2'), (b2,c2,'B2'), (a3,c3,'A3'), (b3,c3,'B3');
  pair := jsonb_build_object('ballotType','both_support','candidateIds',jsonb_build_array(a,b));
  pair2 := jsonb_build_object('ballotType','both_support','candidateIds',jsonb_build_array(a2,b2));
  pair3 := jsonb_build_object('ballotType','both_support','candidateIds',jsonb_build_array(a3,b3));
  normal_vote := public.submit_vote_with_love(c,users[1],jsonb_build_object('candidateId',a),'{}');
  perform public.submit_vote_with_love(c,users[2],jsonb_build_object('candidateId',b),array[b]);
  update public.votes set created_at='2026-01-01T10:00:00Z' where id=normal_vote;
  update public.votes set created_at='2026-01-01T09:00:00Z' where contest_id=c and voter_id=users[2];
  both_vote := public.submit_vote_with_love(c,users[3],pair,'{}');
  assert (select count(*) from public.votes where contest_id=c)=3, 'Both support must be one ballot';
  select * into row_b from public.get_visible_contest_tallies(array[c]) where candidate_id=b;
  assert row_b.score=2 and row_b.love_score=0, 'Live results must still hide love weighting';
  update public.contests set status='published' where id=c;
  select * into row_a from public.get_visible_contest_tallies(array[c]) where candidate_id=a;
  select * into row_b from public.get_visible_contest_tallies(array[c]) where candidate_id=b;
  assert row_a.score=2 and row_a.normal_score=2 and row_a.love_score=0, 'A base points';
  assert row_b.score=4 and row_b.normal_score=1 and row_b.love_score=3, 'B love multiplier';
  assert row_a.last_vote_at='2026-01-01T10:00:00Z'::timestamptz, 'A timestamp changed';
  assert row_b.last_vote_at='2026-01-01T09:00:00Z'::timestamptz, 'B timestamp changed';
  update public.contests set status='voting' where id=c;

  perform pg_temp.expect_both_support_error(format('select public.submit_vote_with_love(%L,%L,%L::jsonb,%L::uuid[])',c,users[4],pair,array[a]), '同时支持票不能');
  perform pg_temp.expect_both_support_error(format('select public.supplement_love_votes(%L,%L,%L::jsonb)',g,users[3],jsonb_build_array(jsonb_build_object('contestId',c,'candidateIds',jsonb_build_array(a)))), '同时支持票不能');
  perform pg_temp.expect_both_support_error(format('insert into public.love_vote_allocations(group_id,contest_id,vote_id,candidate_id,voter_id) values(%L,%L,%L,%L,%L)',g,c,both_vote,a,users[3]), '同时支持票不能');
  assert not exists(select 1 from public.love_vote_allocations where vote_id=both_vote), 'Both support consumed quota';
  perform pg_temp.expect_both_support_error(format('select public.submit_vote_with_love(%L,%L,%L::jsonb)',c,users[3],pair), 'duplicate key');
  perform pg_temp.expect_both_support_error(format('select public.submit_vote_with_love(%L,%L,%L::jsonb)',c,users[4],jsonb_set(pair,'{candidateIds}',jsonb_build_array(a,a))), '同时支持');
  perform pg_temp.expect_both_support_error(format('select public.submit_vote_with_love(%L,%L,%L::jsonb)',c,users[4],pair || jsonb_build_object('candidateId',a)), '同时支持选票数据无效');
  perform pg_temp.expect_both_support_error(format('select public.submit_vote_with_love(%L,%L,%L::jsonb)',c,users[4],pair2), '候选项不属于');

  update public.contests set both_support_enabled=false where id in(c,c3);
  perform pg_temp.expect_both_support_error(format('select public.submit_vote_with_love(%L,%L,%L::jsonb)',c,users[4],pair), '当前不能同时支持');
  select * into row_a from public.get_visible_contest_tallies(array[c]) where candidate_id=a;
  assert row_a.score=2, 'Disabling must preserve existing ballots';
  update public.contests set both_support_enabled=true where id=c;
  update public.contests set vote_type='multiple' where id=c3;
  perform pg_temp.expect_both_support_error(format('select public.submit_vote_with_love(%L,%L,%L::jsonb)',c3,users[4],pair3), '不能同时支持');
  update public.contests set vote_type='ranked' where id=c3;
  perform pg_temp.expect_both_support_error(format('select public.submit_vote_with_love(%L,%L,%L::jsonb)',c3,users[4],pair3), '不能同时支持');
  update public.contests set vote_type='single' where id=c3;
  insert into public.candidates(id,contest_id,name) values(extra,c,'Third candidate');
  perform pg_temp.expect_both_support_error(format('select public.submit_vote_with_love(%L,%L,%L::jsonb)',c,users[4],pair), '当前候选项一致');
  delete from public.candidates where id=extra;
  update public.candidates set is_active=false where id=b;
  perform pg_temp.expect_both_support_error(format('select public.submit_vote_with_love(%L,%L,%L::jsonb)',c,users[4],pair), '候选项不属于');
  update public.candidates set is_active=true where id=b;
  update public.contests set voting_ends_at=now()-interval '1 second' where id=c;
  perform pg_temp.expect_both_support_error(format('select public.submit_vote_with_love(%L,%L,%L::jsonb)',c,users[4],pair), '当前不能同时支持');
  update public.contests set voting_ends_at=null where id=c;

  requests := jsonb_build_array(jsonb_build_object('contestId',c2,'payload',pair2),jsonb_build_object('contestId',c3,'payload',pair3));
  perform pg_temp.expect_both_support_error(format('select public.submit_group_votes_with_love(%L,%L,%L::jsonb)',g,users[4],requests), '当前不能同时支持');
  assert not exists(select 1 from public.votes where voter_id=users[4]), 'Group write must roll back completely';
  requests := jsonb_build_array(jsonb_build_object('contestId',c2,'payload',pair2),jsonb_build_object('contestId',c,'payload',jsonb_build_object('candidateId',a)));
  n := public.submit_group_votes_with_love(g,users[4],requests);
  assert n=2, 'Mixed group submission';
  select * into row_a from public.get_visible_contest_tallies(array[c2]) where candidate_id=a2;
  assert row_a.score=1 and row_a.last_vote_at is null, 'Only both-support ballots must leave time null';

  update public.contest_groups set access_mode='restricted' where id=g;
  perform pg_temp.expect_both_support_error(format('select public.submit_vote_with_love(%L,%L,%L::jsonb)',c2,users[5],pair2), '没有参与');
  insert into public.user_groups(id,name) values(ug,'Both support test members');
  insert into public.contest_group_allowed_user_groups(contest_group_id,user_group_id) values(g,ug);
  insert into public.user_group_members(user_group_id,profile_id,expires_at) values(ug,users[5],now()+interval '1 day');
  group_vote := public.submit_vote_with_love(c2,users[5],pair2);
  assert group_vote is not null, 'Valid group member should be allowed';
  update public.contest_groups set access_mode='public' where id=g;

  n := public.supplement_love_votes(g,users[1],jsonb_build_array(jsonb_build_object('contestId',c,'candidateIds',jsonb_build_array(a))));
  assert n=1, 'Ordinary love supplement regressed';
  assert (select created_at from public.votes where id=normal_vote)='2026-01-01T10:00:00Z'::timestamptz, 'Supplement changed vote time';
  update public.contests set status='published' where id=c;
  select * into row_a from public.get_visible_contest_tallies(array[c]) where candidate_id=a;
  assert row_a.score=5 and row_a.love_score=3 and row_a.normal_score=2, 'Mixed tally after supplement';
  update public.contests set status='voting',live_results_enabled=false where id=c;
  assert (select count(*) from public.get_visible_contest_tallies(array[c]))=0, 'Hidden results leaked';
  assert not has_function_privilege('authenticated','public.submit_vote_with_love(uuid,uuid,jsonb,uuid[])','execute'), 'RPC must remain service-only';
  raise notice 'Both-support SQL checks passed: defaults, scores, times, love restrictions, pair validation, permissions, group rollback, visibility, and legacy supplementation.';
end;
$$;
rollback;
