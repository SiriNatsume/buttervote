import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { parseEnvFile } from '../../scripts/run-with-local-supabase-env.mjs';
import { assertLoopbackUrl } from '../../scripts/local-supabase.mjs';
import { fetchAllRows } from '../../lib/supabase-pagination.ts';
import { tallyVotes } from '../../lib/tally.ts';
import { tallyResultsFromAggregates } from '../../lib/aggregate-tallies.ts';
import { getUserGroupMembershipStatus } from '../../lib/user-group-membership.ts';
const env=parseEnvFile(readFileSync('.local/supabase-app.env','utf8'));
assertLoopbackUrl(env.NEXT_PUBLIC_SUPABASE_URL,'Secondary database performance regression');
const options={auth:{persistSession:false,autoRefreshToken:false}};
const db=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,options);
const anon=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,options);
const check=r=>{assert.equal(r.error,null,r.error?.message);return r.data;};
const f=JSON.parse(readFileSync('.local/page-performance/fixture.json','utf8'));
const contests=check(await db.from('contests').select('id,group_id,vote_type,status').in('id',f.contestIds));
const candidates=check(await db.from('candidates').select('*').in('contest_id',f.contestIds));
const votes=check(await fetchAllRows(()=>db.from('votes').select('*',{count:'exact'}).in('contest_id',f.contestIds).order('id')));
const love=check(await db.from('love_vote_allocations').select('*').in('contest_id',f.contestIds));
const tallies=check(await anon.rpc('get_visible_contest_tallies',{p_contest_ids:f.contestIds,p_include_admin_override:false}));
const visibility=check(await anon.rpc('get_contest_result_visibility',{p_contest_ids:f.contestIds,p_include_admin_override:false}));
for(const contest of contests.filter(c=>c.status!=='nominating')) {
 const weighted=visibility.find(v=>v.contest_id===contest.id).show_weighted_love_score;
 const cs=candidates.filter(c=>c.contest_id===contest.id);
 const expected=tallyVotes({voteType:contest.vote_type,candidates:cs,votes:votes.filter(v=>v.contest_id===contest.id),loveVoteWeight:contest.group_id?3:null,loveVoteScoreMode:weighted?'weighted':'base',loveAllocations:weighted?love.filter(l=>l.contest_id===contest.id):[]});
 const actual=tallyResultsFromAggregates({candidates:cs,tallies:tallies.filter(t=>t.contest_id===contest.id),loveVoteWeight:contest.group_id?3:1,showWeightedLoveScore:weighted});
 const canonical=rows=>rows.map(r=>({...r,lastVoteAt:r.lastVoteAt?new Date(r.lastVoteAt).toISOString():null}));
 assert.deepEqual(canonical(actual),canonical(expected));
}
assert.equal(tallies.length,15);
console.log('All 15000 grouped/standalone votes match aggregate rankings, zero-safe scores, and timestamps.');
const countResult=await anon.rpc('get_visible_contest_love_vote_allocations',{p_contest_ids:[f.groupedResultId],p_include_admin_override:false},{head:true,count:'exact'});
check(countResult);assert.equal(countResult.count,1);assert.equal(countResult.data,null);
console.log('Public love-vote total is counted without transferring allocation rows.');
const memberships=check(await fetchAllRows(()=>db.from('user_group_members').select('expires_at,revoked_at',{count:'exact'}).eq('user_group_id',f.userGroupId).order('id')));
const stats=check(await db.rpc('get_admin_user_group_member_stats',{})).find(r=>r.user_group_id===f.userGroupId);
assert.equal(Number(stats.total),1200);assert.equal(Number(stats.active),memberships.filter(m=>getUserGroupMembershipStatus(m)==='active').length);assert.equal(Number(stats.active),900);
console.log('Membership aggregate preserves permanent, active, expired and revoked states: 1200 total / 900 active.');
const usage=check(await db.rpc('get_admin_candidate_vote_usage',{p_contest_id:f.groupedResultId}));
assert.equal(usage.length,3);
const lastCandidate=candidates.filter(c=>c.contest_id===f.groupedResultId)[2];
try {
 check(await db.from('candidates').update({is_active:false}).eq('id',lastCandidate.id));
 assert.ok(check(await db.rpc('get_admin_candidate_vote_usage',{p_contest_id:f.groupedResultId})).some(r=>r.candidate_id===lastCandidate.id));
 assert.equal(check(await anon.rpc('get_visible_contest_tallies',{p_contest_ids:[f.groupedResultId]})).length,2);
 assert.equal(check(await anon.rpc('get_visible_contest_tallies',{p_contest_ids:[f.groupedResultId],p_include_admin_override:true})).length,2);
 const adminRows=check(await db.rpc('get_visible_contest_tallies',{p_contest_ids:[f.groupedResultId],p_include_admin_override:true}));
 assert.equal(adminRows.length,3);
 assert.equal(adminRows.find(r=>r.candidate_id===lastCandidate.id).score,1000);
} finally {check(await db.from('candidates').update({is_active:true}).eq('id',lastCandidate.id));}
console.log('Historical usage includes votes beyond the API row limit and inactive candidates.');
for(const name of ['get_admin_user_group_member_stats','get_admin_candidate_vote_usage']) {
 const args=name.endsWith('usage')?{p_contest_id:f.groupedResultId}:{};
 const r=await anon.rpc(name,args);assert.ok(r.error);assert.equal(r.data,null);
}
for(const role of ['user','admin']) {
 const client=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,options);
 check(await client.auth.signInWithPassword({email:`${role}@buttervote.local`,password:role==='admin'?'ButterVoteAdmin123!':'ButterVoteUser123!'}));
 try {
  const rows=check(await client.rpc('get_admin_user_group_member_stats',{}));
  assert.equal(rows.some(r=>r.user_group_id===f.userGroupId),role==='admin');
  const selected=check(await client.rpc('get_admin_candidate_vote_usage',{p_contest_id:f.groupedResultId}));
  assert.equal(selected.length,role==='admin'?3:0);
  if(role==='user') {
   try {
    check(await db.from('contests').update({status:'closed',closed_result_visibility:'admin_only'}).eq('id',f.groupedResultId));
    assert.equal(check(await client.rpc('get_visible_contest_tallies',{p_contest_ids:[f.groupedResultId],p_include_admin_override:true})).length,0);
    assert.equal(check(await db.rpc('get_visible_contest_tallies',{p_contest_ids:[f.groupedResultId],p_include_admin_override:false})).length,0);
    assert.equal(check(await db.rpc('get_visible_contest_tallies',{p_contest_ids:[f.groupedResultId],p_include_admin_override:true})).length,3);
   } finally {check(await db.from('contests').update({status:'published'}).eq('id',f.groupedResultId));}
  }
 } finally {check(await client.auth.signOut({scope:'local'}));}
}
console.log('Anonymous and ordinary users cannot read admin summaries; actual admins and service calls retain access.');
