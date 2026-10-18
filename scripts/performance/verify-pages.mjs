import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes,createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { parseEnvFile } from '../../scripts/run-with-local-supabase-env.mjs';
import { assertLoopbackUrl } from '../../scripts/local-supabase.mjs';
import { encodeReviewCursor } from '../../lib/review-pagination.ts';
const env=parseEnvFile(readFileSync('.local/supabase-app.env','utf8'));
assertLoopbackUrl(env.NEXT_PUBLIC_SUPABASE_URL,'Bounded page verification');
const db=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const check=r=>{assert.equal(r.error,null,r.error?.message);return r.data;};
const f=JSON.parse(readFileSync('.local/page-performance/fixture.json','utf8'));
const hashes=[];
async function cookieFor(role) {
 const p=check(await db.from('profiles').select('id').eq('email',`${role}@buttervote.local`).single());
 const token=randomBytes(32).toString('hex'),hash=createHash('sha256').update(token).digest('hex');hashes.push(hash);
 check(await db.from('app_sessions').insert({profile_id:p.id,session_token_hash:hash,expires_at:new Date(Date.now()+3600000).toISOString()}));
 return `${env.APP_SESSION_COOKIE_NAME||'app_session'}=${token}`;
}
let admin;
let user;
const get=async(path,cookie=admin)=>{
 const response=await fetch(new URL(path,'http://127.0.0.1:3000'),{headers:cookie?{cookie}:{},redirect:'manual'});
 assert.equal(response.status,200);return response.text();
};
const ids=(html,attribute)=>[...new Set([...html.matchAll(new RegExp(`${attribute}="([a-f0-9-]+)"`,'g'))].map(m=>m[1]))];
const link=(html,direction)=>html.match(new RegExp(`href="(/admin\\?review${direction}=[^"]+#pending-nominations)"`))?.[1]??null;
try {
 admin=await cookieFor('admin');user=await cookieFor('user');
 const totalResult=await db.from('nominations').select('id,contests!inner(id)',{count:'exact',head:true}).eq('status','pending').is('contests.archived_at',null);check(totalResult);
 const queueCount=totalResult.count;
 const expected=check(await db.from('nominations').select('id,created_at,contests!inner(id)').eq('status','pending').is('contests.archived_at',null).order('created_at').order('id').range(0,49));
 const first=await get('/admin');
 const firstIds=ids(first,'data-nomination-id');
 assert.equal(firstIds.length,50);assert.deepEqual(firstIds,expected.map(r=>r.id));
 const next=link(first,'After');assert.ok(next);
 const second=await get(next);
 const secondIds=ids(second,'data-nomination-id');assert.equal(secondIds.length,50);
 assert.equal(secondIds.some(id=>firstIds.includes(id)),false);
 const previous=link(second,'Before');assert.ok(previous);
 assert.deepEqual(ids(await get(previous),'data-nomination-id'),firstIds);
 assert.deepEqual(ids(await get('/admin?reviewAfter=invalid'),'data-nomination-id'),firstIds);
 const future=encodeReviewCursor({created_at:'2099-01-01T00:00:00Z',id:'ffffffff-ffff-4fff-8fff-ffffffffffff'});
 assert.deepEqual(ids(await get(`/admin?reviewAfter=${future}`),'data-nomination-id'),firstIds);
 const seen=new Set(firstIds);
 let href=next,pages=1;
 while(href) {
  const html=await get(href);const page=ids(html,'data-nomination-id');
  assert.ok(page.length>0&&page.length<=50);
  for(const id of page){assert.equal(seen.has(id),false);seen.add(id);}
  href=link(html,'After');pages++;
  assert.ok(pages<=Math.ceil(queueCount/50)+1);
 }
 assert.equal(seen.size,queueCount);
 console.log(`Review queue: ${queueCount} records across ${pages} pages, no gaps/duplicates; reverse, invalid and empty cursors pass.`);
 const firstVotes=check(await db.from('votes').select('id').eq('contest_id',f.groupedResultId).order('created_at').order('id').range(0,49));
 const audit=await get(`/contests/${f.groupedResultId}/results`);
 assert.deepEqual(ids(audit,'data-vote-id'),firstVotes.map(r=>r.id));
 const audit2=await get(`/contests/${f.groupedResultId}/results?votePage=2`);
 const voteIds2=ids(audit2,'data-vote-id');assert.equal(voteIds2.length,50);assert.equal(voteIds2.some(id=>firstVotes.some(r=>r.id===id)),false);
 const lastVotes=check(await db.from('votes').select('id').eq('contest_id',f.groupedResultId).order('created_at').order('id').range(2950,2999));
 assert.deepEqual(ids(await get(`/contests/${f.groupedResultId}/results?votePage=1000000`),'data-vote-id'),lastVotes.map(r=>r.id));
 // Exercise page-scoped voter profile lookups with fixture-owned identities.
 const selected=check(await db.from('votes').select('*').in('id',firstVotes.map(r=>r.id)).order('created_at').order('id'));
 check(await db.from('votes').upsert(selected.map((vote,i)=>({...vote,voter_id:f.profileIds[i]}))));
 const namedAudit=await get(`/contests/${f.groupedResultId}/results`);
 assert.ok(namedAudit.includes('性能二期成员 0'));
 assert.equal(ids(namedAudit,'data-vote-id').length,50);
 console.log('Admin audit: bounded to 50 records, forward/clamped pages and fixture voter names pass.');
 for(const cookie of [null,user]) {
  assert.equal(ids(await get('/admin',cookie),'data-nomination-id').length,0);
  assert.equal(ids(await get(`/contests/${f.groupedResultId}/results?votePage=2`,cookie),'data-vote-id').length,0);
  assert.equal((await get('/admin/user-groups',cookie)).includes('性能二期 · 临时用户组'),false);
 }
 console.log('Unauthenticated and ordinary requests do not receive review, vote-audit or membership data.');
} finally {check(await db.from('app_sessions').delete().in('session_token_hash',hashes));}
