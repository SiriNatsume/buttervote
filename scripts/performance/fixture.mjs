import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { parseEnvFile } from '../../scripts/run-with-local-supabase-env.mjs';
import { assertLoopbackUrl } from '../../scripts/local-supabase.mjs';
const env=parseEnvFile(readFileSync('.local/supabase-app.env','utf8'));
assertLoopbackUrl(env.NEXT_PUBLIC_SUPABASE_URL,'Secondary performance fixture');
const db=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const check=r=>{if(r.error)throw new Error(r.error.message);return r.data;};
const file='.local/page-performance/fixture.json';
mkdirSync('.local/page-performance',{recursive:true});
if(process.argv[2]==='seed') {
 if(existsSync(file))throw new Error('Fixture manifest already exists');
 const groupId=randomUUID(),userGroupId=randomUUID();
 const specs=[['single','published',true],['multiple','published',true],['ranked','published',true],['single','published',false],['single','voting',false],['single','nominating',false]];
 const contests=specs.map(([vote_type,status,grouped],i)=>({id:randomUUID(),title:`性能二期 · ${i+1} ${vote_type} ${status}`,group_id:grouped?groupId:null,status,vote_type,max_choices:3,live_results_enabled:true,max_nominations_per_user:null}));
 const candidates=contests.filter(c=>c.status!=='nominating').flatMap(c=>[0,1,2].map(i=>({id:randomUUID(),contest_id:c.id,name:`二期候选 ${c.title.split(' · ')[1]} ${i+1}`,is_active:true})));
 const profileIds=Array.from({length:1200},()=>randomUUID());
 const originalCounts={};
 for(const table of ['profiles','contests','votes','nominations','user_group_members','contest_groups','user_groups']) {
  const r=await db.from(table).select('id',{count:'exact',head:true});check(r);originalCounts[table]=r.count;
 }
 const manifest={groupId,userGroupId,contestIds:contests.map(c=>c.id),profileIds,originalCounts,groupedResultId:contests[0].id,standaloneResultId:contests[3].id,standaloneVoteId:contests[4].id,nominationContestId:contests[5].id,candidateIds:candidates.map(c=>c.id)};
 writeFileSync(file,JSON.stringify(manifest));
 check(await db.from('contest_groups').insert({id:groupId,name:'性能二期 · 临时活动组',love_vote_weight:3,love_vote_quota:10}));
 check(await db.from('contests').insert(contests));
 check(await db.from('candidates').insert(candidates));
 const owner=check(await db.from('profiles').select('id').eq('email','user@buttervote.local').single());
 for(const contest of contests.filter(c=>c.status!=='nominating')) {
  const ids=candidates.filter(c=>c.contest_id===contest.id).map(c=>c.id);
  const votes=Array.from({length:3000},(_,i)=>({id:randomUUID(),contest_id:contest.id,voter_id:null,payload:contest.vote_type==='single'?{candidateId:ids[Math.floor(i/1000)]}:contest.vote_type==='multiple'?{candidateIds:[ids[i%3],ids[(i+1)%3]]}:{ranking:[ids[i%3],ids[(i+1)%3],ids[(i+2)%3]]},created_at:new Date(Date.UTC(2026,9,17,0,0,i)).toISOString()}));
  for(let offset=0;offset<votes.length;offset+=500)check(await db.from('votes').insert(votes.slice(offset,offset+500)));
  if(contest.group_id)check(await db.from('love_vote_allocations').insert({group_id:groupId,contest_id:contest.id,vote_id:votes[0].id,candidate_id:ids[0],voter_id:owner.id}));
 }
 for(let offset=0;offset<1200;offset+=400) {
  check(await db.from('profiles').insert(profileIds.slice(offset,offset+400).map((id,i)=>({id,display_name:`性能二期成员 ${offset+i}`,role:'user'}))));
 }
 check(await db.from('user_groups').insert({id:userGroupId,name:'性能二期 · 临时用户组'}));
 const futureExpiry=new Date(Date.now()+86400000).toISOString();
 const pastExpiry=new Date(Date.now()-86400000).toISOString();
 const revokedAt=new Date().toISOString();
 const memberships=profileIds.map((id,i)=>({user_group_id:userGroupId,profile_id:id,source:'performance_fixture',expires_at:i<600?'infinity':i<900?futureExpiry:i<1100?pastExpiry:futureExpiry,revoked_at:i>=1100?revokedAt:null}));
 for(let offset=0;offset<memberships.length;offset+=400)check(await db.from('user_group_members').insert(memberships.slice(offset,offset+400)));
 const nominations=Array.from({length:1200},(_,i)=>({id:randomUUID(),contest_id:manifest.nominationContestId,submitter_id:owner.id,name:`性能二期提名 ${i+1}`,description:'用于验证大量提名时后台审核加载、翻页和批量选择的临时记录。'.repeat(3),status:'pending',created_at:'2026-10-18T00:00:00Z'}));
 for(let offset=0;offset<nominations.length;offset+=400)check(await db.from('nominations').insert(nominations.slice(offset,offset+400)));
 console.log(JSON.stringify({contests:contests.length,votes:15000,nominations:1200,memberships:1200}));
} else if(process.argv[2]==='cleanup') {
 const f=JSON.parse(readFileSync(file,'utf8'));
 const group=check(await db.from('contest_groups').select('name').eq('id',f.groupId).maybeSingle());
 const ug=check(await db.from('user_groups').select('name').eq('id',f.userGroupId).maybeSingle());
 if((group&&group.name!=='性能二期 · 临时活动组')||(ug&&ug.name!=='性能二期 · 临时用户组'))throw new Error('Fixture ownership check failed');
 const owned=check(await db.from('contests').select('id,title').in('id',f.contestIds));
 if(owned.some(c=>!c.title.startsWith('性能二期 · ')))throw new Error('Contest fixture ownership check failed');
 check(await db.from('contests').delete().in('id',f.contestIds));
 check(await db.from('contest_groups').delete().eq('id',f.groupId));
 check(await db.from('user_groups').delete().eq('id',f.userGroupId));
 for(let offset=0;offset<f.profileIds.length;offset+=100) {
  const batch=f.profileIds.slice(offset,offset+100);
  const profiles=check(await db.from('profiles').select('id,display_name').in('id',batch));
  if(profiles.some(p=>!p.display_name?.startsWith('性能二期成员 ')))throw new Error('Profile fixture ownership check failed');
  check(await db.from('profiles').delete().in('id',batch));
 }
 for(const [table,count] of Object.entries(f.originalCounts)) {
  const r=await db.from(table).select('id',{count:'exact',head:true});check(r);if(r.count!==count)throw new Error(`Fixture cleanup count mismatch in ${table}`);
 }
 console.log('Secondary performance fixtures removed; all original table counts restored.');
}
