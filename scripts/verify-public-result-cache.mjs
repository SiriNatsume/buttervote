import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { createClient } from "@supabase/supabase-js";
import { createPublicSnapshotLoader } from "../lib/public-result-snapshot-core.ts";
import { createVersionedArtifactCache } from "../lib/cache/versioned-artifact-cache.ts";
import { tallyVotes } from "../lib/tally.ts";
import { tallyResultsFromAggregates } from "../lib/aggregate-tallies.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!url || !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) throw new Error("Local Supabase only");
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
const groupId = randomUUID();
const ids = Array.from({ length: 6 }, () => randomUUID());
const sessionId = randomUUID();
const prefix = `perf3_${randomUUID().replaceAll("-", "")}`;
const alias = `${prefix}_tallies`;
const oldCandidate = `${prefix}_candidate`;
const candidates = ids.slice(0, 5).flatMap((contest_id) => [0, 1, 2].map((index) => ({ id: randomUUID(), contest_id, name: `Snapshot candidate ${index}`, is_active: true })));
const candidateFor = (id) => candidates.filter((candidate) => candidate.contest_id === id);
const votes = [];
const love = [];
let snapshotReads = 0;
let guardReads = 0;
async function data(query) { const { data, error } = await query; if (error) throw new Error(error.message); return data; }
const sql = (query) => execFileSync("docker", ["exec", "-i", "supabase_db_butter-vote-local", "psql", "-U", "postgres", "-d", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1"], { input: query, encoding: "utf8" });
const canonical = (rows) => rows.map(({ candidateId, score, normalScore, loveScore, loveVoteCount }) => ({ candidateId, score, normalScore, loveScore, loveVoteCount })).sort((a,b)=>a.candidateId.localeCompare(b.candidateId));
const loader = createPublicSnapshotLoader({
  cache: createVersionedArtifactCache(),
  loadVersions: async (requested) => { guardReads += 1; return data(anon.from("public_result_cache_versions").select("contest_id,revision").in("contest_id", requested)); },
  loadSnapshots: async (versions) => { snapshotReads += 1; return data(anon.rpc("get_public_result_snapshots", {p_contest_ids:versions.map(v=>v.contest_id),p_revisions:versions.map(v=>v.revision)})); },
});
const versions = () => data(db.from("public_result_cache_versions").select("contest_id,revision").in("contest_id", ids));

try {
  // A local-only reference isolates the candidate-materialization change. Both
  // functions run against the same current RLS and return the same public rows.
  const reference = readFileSync("supabase/migrations/20261018023743_page_performance_aggregates.sql", "utf8").split("\n\n-- These admin summaries")[0].replaceAll("get_visible_contest_tallies", alias);
  const candidateReference = readFileSync("supabase/migrations/20260715074608_contest_result_visibility_state.sql", "utf8").split("create or replace function public.can_read_candidate")[1].split("create or replace function public.get_visible_contest_nominations")[0];
  sql(`${reference}\ncreate or replace function public.${oldCandidate}${candidateReference}\nnotify pgrst, 'reload schema';`);
  await data(db.from("contest_groups").insert({id:groupId,name:"Performance round three verification",love_vote_weight:2.5,love_vote_quota:10}));
  const types = ["single", "multiple", "ranked", "single", "single", "single"];
  await data(db.from("contests").insert(ids.map((id,index)=>({id,group_id:groupId,title:`Performance round three ${index}`,status:"voting",vote_type:types[index],max_choices:3,live_results_enabled:true,closed_result_visibility:index===5?"admin_only":"public"}))));
  await data(db.from("candidates").insert(candidates));
  const owner = await data(db.from("profiles").select("id").eq("email","user@buttervote.local").single());
  const activeVersion = (await versions()).find(v=>v.contest_id===ids[3]).revision;
  for(let index=0;index<3;index+=1){
    const cid=ids[index], cs=candidateFor(cid);
    const batch=Array.from({length:3000},(_,i)=>({id:randomUUID(),contest_id:cid,voter_id:null,payload:index===0?{candidateId:cs[i%3].id}:index===1?{candidateIds:[cs[i%3].id,cs[(i+1)%3].id]}:{ranking:[cs[i%3].id,cs[(i+1)%3].id,cs[(i+2)%3].id]},created_at:new Date(Date.UTC(2026,9,20,0,0,i)).toISOString()}));
    votes.push(...batch);
    for(let offset=0;offset<batch.length;offset+=500)await data(db.from("votes").insert(batch.slice(offset,offset+500)));
    const allocation={group_id:groupId,contest_id:cid,vote_id:batch[0].id,candidate_id:cs[0].id,voter_id:owner.id};
    love.push(allocation);await data(db.from("love_vote_allocations").insert(allocation));
  }
  await data(db.from("votes").insert({contest_id:ids[3],payload:{candidateId:candidateFor(ids[3])[0].id},voter_id:null}));
  assert.equal((await versions()).find(v=>v.contest_id===ids[3]).revision,activeVersion,"live votes must not contend on a cache revision");
  await data(db.from("contests").update({status:"published"}).in("id",ids.slice(0,3)));
  await data(db.from("contests").update({status:"closed"}).eq("id",ids[5]));
  const inherited=randomUUID();
  await data(db.from("candidates").insert({id:inherited,contest_id:ids[4],name:"Inherited cache candidate",is_active:true,inherited_from_candidate_id:candidateFor(ids[0])[0].id}));
  await data(db.from("contests").update({status:"published"}).eq("id",ids[4]));

  const timelines = [];
  for(const name of [alias,"get_visible_contest_tallies"]){
    const samples=[];let result;
    for(let run=0;run<4;run+=1){const start=performance.now();result=await data(anon.rpc(name,{p_contest_ids:ids.slice(0,3),p_include_admin_override:false}));if(run)samples.push(Math.round(performance.now()-start));}
    for(let index=0;index<3;index+=1){
      const cs=candidateFor(ids[index]);
      const expected=tallyVotes({voteType:types[index],candidates:cs,votes:votes.filter(v=>v.contest_id===ids[index]),loveVoteWeight:2.5,loveVoteScoreMode:"weighted",loveAllocations:love.filter(v=>v.contest_id===ids[index])});
      const actual=tallyResultsFromAggregates({candidates:cs,tallies:result.filter(row=>row.contest_id===ids[index]),loveVoteWeight:2.5,showWeightedLoveScore:true});
      assert.deepEqual(canonical(actual),canonical(expected));
    }
    timelines.push({implementation:name===alias?"reference":"preaggregated-candidate-points",samplesMs:samples,medianMs:[...samples].sort((a,b)=>a-b)[1]});
  }
  const first = await loader(ids);
  assert.equal(first.size,4); // three published contests and the inherited round
  const counts={snapshotReads,guardReads};
  await loader(ids);
  assert.equal(snapshotReads,counts.snapshotReads);
  assert.equal(guardReads,counts.guardReads+1);
  assert.equal(first.has(ids[3]),false);assert.equal(first.has(ids[5]),false);
  const firstRevision=first.get(ids[0]).revision;
  await data(db.from("candidates").update({name:"Renamed public candidate"}).eq("id",candidateFor(ids[0])[0].id));
  const renamed = await loader(ids);
  assert.notEqual(renamed.get(ids[0]).revision,firstRevision);
  assert.ok(renamed.get(ids[0]).candidates.some(c=>c.name==="Renamed public candidate"));
  assert.deepEqual(await data(anon.rpc("get_public_result_snapshots",{p_contest_ids:[ids[0]],p_revisions:[firstRevision]})),[]);
  const weightRevision=renamed.get(ids[1]).revision;
  await data(db.from("contest_groups").update({love_vote_weight:3}).eq("id",groupId));
  assert.notEqual((await loader(ids)).get(ids[1]).revision,weightRevision);
  await data(db.from("votes").update({payload:{candidateId:candidateFor(ids[0])[1].id}}).eq("id",votes[0].id));
  assert.notEqual((await loader(ids)).get(ids[0]).revision,renamed.get(ids[0]).revision);
  await data(db.from("contest_calling_sessions").insert({id:sessionId,contest_id:ids[0],seed:"snapshot-cache-test",status:"draft",total_steps:1}));
  const hidden = await loader(ids);
  assert.equal(hidden.has(ids[0]),false,"calling immediately revokes a warm snapshot");
  assert.equal(hidden.has(ids[4]),false,"calling in a source revokes a warm downstream snapshot");
  assert.equal((await data(anon.from("public_result_cache_versions").select("contest_id").in("contest_id",[ids[0],ids[4]]))).length,0);
  const admin=createClient(url,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,options);
  await data(admin.auth.signInWithPassword({email:"admin@buttervote.local",password:"ButterVoteAdmin123!"}));
  try {
    assert.equal((await data(admin.from("public_result_cache_versions").select("contest_id").eq("contest_id",ids[0]))).length,0,
      "the public cache has no admin override, even for a real administrator");
    assert.ok((await data(admin.rpc("get_visible_contest_tallies",{p_contest_ids:[ids[0]],p_include_admin_override:true}))).length);
  } finally { await admin.auth.signOut({scope:"local"}); await admin.removeAllChannels(); }
  await data(db.from("contest_calling_sessions").delete().eq("id",sessionId));
  assert.ok((await loader(ids)).has(ids[4]));
  await data(db.from("contests").update({archived_at:new Date().toISOString()}).eq("id",ids[0]));
  assert.equal((await loader(ids)).has(ids[4]),false);
  const checkIds=[...candidates.map(c=>c.id),inherited];
  const candidatesSql=checkIds.map(candidateId=>`'${candidateId}'::uuid`).join(",");
  assert.match(sql(`begin;set local role anon;select bool_and(public.can_read_candidate(id) is not distinct from public.${oldCandidate}(id)) from unnest(array[${candidatesSql}]) as candidates(id);rollback;`),/^t$/m);
  await data(db.from("contests").update({archived_at:null}).eq("id",ids[0]));
  await data(db.from("votes").insert([
    {contest_id:ids[0],payload:{candidateId:"not-a-uuid"},voter_id:null},
    {contest_id:ids[0],payload:{candidateId:candidateFor(ids[1])[0].id},voter_id:null},
    {contest_id:ids[1],payload:{candidateIds:[candidateFor(ids[1])[0].id,candidateFor(ids[1])[0].id,"unknown"]},voter_id:null},
    {contest_id:ids[2],payload:{ranking:["unknown",candidateFor(ids[2])[0].id,candidateFor(ids[2])[1].id,candidateFor(ids[2])[2].id]},voter_id:null},
  ]));
  const referenceRows=await data(anon.rpc(alias,{p_contest_ids:ids.slice(0,3),p_include_admin_override:false}));
  const currentRows=await data(anon.rpc("get_visible_contest_tallies",{p_contest_ids:ids.slice(0,3),p_include_admin_override:false}));
  const ordered=rows=>rows.sort((a,b)=>a.candidate_id.localeCompare(b.candidate_id));
  assert.deepEqual(ordered(currentRows),ordered(referenceRows),"unknown IDs, cross-contest IDs and duplicate/malformed choices retain the existing scoring behavior");
  let ancestors=candidateFor(ids[0]).map(candidate=>candidate.id);
  for(let level=0;level<5;level+=1){
    const contestId=randomUUID();ids.push(contestId);
    await data(db.from("contests").insert({id:contestId,group_id:groupId,title:`Performance lineage ${level}`,status:"published",vote_type:"single"}));
    const rows=ancestors.map(source=>({id:randomUUID(),contest_id:contestId,name:`Lineage ${level}`,is_active:true,inherited_from_candidate_id:source}));
    await data(db.from("candidates").insert(rows));ancestors=rows.map(row=>row.id);
  }
  const leafIds=ancestors.map(candidateId=>`'${candidateId}'::uuid`).join(",");
  const lineageTimelines=[];
  for(const name of [oldCandidate,"can_read_candidate"]){
    const times=[];
    for(let run=0;run<4;run+=1){
      const plan=JSON.parse(sql(`begin;set local role anon;explain(analyze,format json,timing off) select count(*) from unnest(array[${leafIds}]) as candidates(id) where public.${name}(id);rollback;`));
      assert.equal(plan[0].Plan["Actual Rows"],1);
      if(run)times.push(plan[0]["Execution Time"]);
    }
    lineageTimelines.push({implementation:name===oldCandidate?"reference":"batched-lineage",executionMs:times});
  }
  console.log(JSON.stringify({votes:9000,timelines,lineageTimelines,cache:"fresh guard on every hit; edits, weights, votes, calling, inheritance and archival verified"}));
  mkdirSync(".local/performance-round-three",{recursive:true});
  writeFileSync(".local/performance-round-three/database.json",JSON.stringify({votes:9000,timelines,lineageTimelines,snapshotReads,guardReads},null,2));
} finally {
  await data(db.from("contests").delete().in("id",ids));
  await data(db.from("contest_groups").delete().eq("id",groupId));
  sql(`drop function if exists public.${alias}(uuid[],boolean);drop function if exists public.${oldCandidate}(uuid);notify pgrst, 'reload schema';`);
  await Promise.allSettled([db.removeAllChannels(),anon.removeAllChannels()]);
}
