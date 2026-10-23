import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!url || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw new Error('Local Supabase only');
process.env.NODE_ENV = 'development';
const { exportBracketImage, loadBracketExportState } = await import('../lib/bracket-image/export.ts');
const { getBracketImageDataForGroup } = await import('../lib/bracket-image/data.ts');
const { warmBracketImage } = await import('../lib/bracket-image/warmup.ts');
const { renderBracketImageWithAssets } = await import('../lib/bracket-image/svg.ts');
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
const group = randomUUID(), tournament = randomUUID();
const contests = [randomUUID(), randomUUID()];
const stages = [randomUUID(), randomUUID()];
const candidates = Array.from({ length: 4 }, () => randomUUID());
const entries = Array.from({ length: 3 }, () => randomUUID());
const votes = Array.from({ length: 6 }, () => randomUUID());
const session = randomUUID();
const imagePath = `candidates/${candidates[0]}/bracket-cache-test.jpg`;
const policy = `bracket_test_${randomUUID().replaceAll('-', '')}`;
const sql = (query) => execFileSync('docker', ['exec', '-i', 'supabase_db_butter-vote-local', 'psql', '-U', 'postgres', '-d', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'], { input: query, encoding: 'utf8' });
const data = async (query) => { const result = await query; if (result.error) throw new Error(result.error.message); return result.data; };
const state = () => loadBracketExportState(group, tournament);
const load = (client = anon) => getBracketImageDataForGroup({ supabase: client, groupId: group, tournamentId: tournament });
const render = async (request = {}) => {
  const started = performance.now();
  const result = await exportBracketImage({ caller: anon, groupId: group, tournamentId: tournament, ...request });
  assert.equal(result.kind, 'ready');
  const meta = await sharp(result.png).metadata();
  assert.deepEqual([meta.width, meta.height], [2880, 1620]);
  return { ...result, ms: Math.round(performance.now() - started), hash: createHash('sha256').update(result.png).digest('hex') };
};
let admin;
let succeeded = false;
const keepFixture = process.argv.includes('--keep-fixture');
try {
  sql("notify pgrst, 'reload schema';");
  await data(db.from('contest_groups').insert({ id: group, name: 'Bracket cache local test', love_vote_weight: 2.5 }));
  await data(db.from('contests').insert(contests.map((id, index) => ({ id, group_id: group, title: `Cache stage ${index}`, status: 'published', vote_type: 'single', love_vote_enabled: true }))));
  await data(db.from('candidates').insert([
    { id: candidates[0], contest_id: contests[0], name: '选手甲', is_active: true },
    { id: candidates[1], contest_id: contests[0], name: '选手乙', is_active: true },
    { id: candidates[2], contest_id: contests[1], name: '选手甲', is_active: true, inherited_from_candidate_id: candidates[0] },
    { id: candidates[3], contest_id: contests[1], name: '选手丙', is_active: true },
  ]));
  await data(db.from('tournaments').insert({ id: tournament, name: '对阵图缓存验证', status: 'completed' }));
  await data(db.from('tournament_stages').insert(stages.map((id, i) => ({ id, tournament_id: tournament, kind: 'knockout', contest_id: contests[i], group_id: group, sequence: i + 1, status: 'published' }))));
  await data(db.from('tournament_entries').insert(entries.map((id, i) => ({ id, tournament_id: tournament, root_candidate_id: candidates[i === 2 ? 3 : i], current_candidate_id: candidates[i === 0 ? 2 : i === 2 ? 3 : 1], screening_rank: i + 1, status: i === 0 ? 'champion' : 'eliminated' }))));
  await data(db.from('tournament_matches').insert([
    { tournament_id: tournament, stage_id: stages[0], contest_id: contests[0], round: 'semifinal', slot: 1, left_entry_id: entries[0], right_entry_id: entries[1], winner_entry_id: entries[0], loser_entry_id: entries[1] },
    { tournament_id: tournament, stage_id: stages[1], contest_id: contests[1], round: 'final', slot: 1, left_entry_id: entries[0], right_entry_id: entries[2], winner_entry_id: entries[0], loser_entry_id: entries[2] },
  ]));
  await data(db.from('votes').insert(votes.map((id, i) => ({ id, contest_id: contests[Math.floor(i / 3)], voter_id: null, payload: { candidateId: candidates[Math.floor(i / 3) * 2 + (i % 3 === 2 ? 1 : 0)] } }))));
  const voters = await data(db.from('profiles').select('id').limit(2));
  assert.equal(voters.length, 2);
  await data(db.from('love_vote_allocations').insert([1, 4].map((i, index) => ({ group_id: group, voter_id: voters[index].id, vote_id: votes[i], contest_id: contests[Math.floor(i / 3)], candidate_id: candidates[Math.floor(i / 3) * 2] }))));
  assert.ok((await anon.rpc('get_bracket_image_export_state', { p_group_id: group })).error, 'clients cannot call the service-only RPC');
  let current = await state();
  assert.equal(current.cacheable, true);
  const baseline = await load();
  assert.equal(baseline.visibilityVersion, current.visibilityVersion);
  assert.equal(baseline.matches.find(m => m.round === 'final').left.score, 3.5);
  const cold = await render();
  const hot = await render();
  assert.equal(cold.cache, 'MISS'); assert.equal(hot.cache, 'HIT'); assert.equal(cold.hash, hot.hash);
  assert.ok(hot.etag);
  const validate = (etag, requestedVersion) => exportBracketImage({ caller: anon, groupId: group, tournamentId: tournament, ifNoneMatch: etag, requestedVersion });
  assert.equal((await validate(hot.etag)).kind, 'not-modified', 'prepared bytes can be revalidated without returning the PNG');
  await data(db.from('contest_groups').update({ name: '预生成验证' }).eq('id', group));
  await warmBracketImage(group, tournament);
  assert.equal((await render()).cache, 'HIT', 'anonymous background warmup prepares the image before a user requests it');

  // Real database changes, not only unit-test token changes.
  for (const [name, query] of [
    ['candidate rename', () => db.from('candidates').update({ name: '选手甲改名' }).eq('id', candidates[2])],
    ['group weight', () => db.from('contest_groups').update({ love_vote_weight: 3 }).eq('id', group)],
    ['published vote edit', () => db.from('votes').update({ payload: { candidateId: candidates[3] } }).eq('id', votes[3])],
    ['entry ranking', () => db.from('tournament_entries').update({ screening_rank: 5 }).eq('id', entries[0])],
  ]) {
    const prepared = await render();
    const before = (await state()).revision;
    await data(query());
    assert.notEqual((await state()).revision, before, name);
    const changed = await render({ ifNoneMatch: prepared.etag });
    assert.equal(changed.cache, 'MISS', name);
    assert.notEqual(changed.etag, prepared.etag, `${name} cannot validate old browser bytes`);
  }

  const red = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ff0000' } }).jpeg().toBuffer();
  const blue = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#0000ff' } }).jpeg().toBuffer();
  await data(db.storage.from('vote-images').upload(imagePath, red, { contentType: 'image/jpeg', upsert: true }));
  await data(db.from('candidates').update({ image_path: imagePath }).eq('id', candidates[0]));
  const beforeImage = await state();
  const redImage = await render();
  await data(db.storage.from('vote-images').upload(imagePath, blue, { contentType: 'image/jpeg', upsert: true }));
  const afterImage = await state();
  assert.notEqual(afterImage.assets[imagePath], beforeImage.assets[imagePath], 'same-path replacement changes the asset version');
  assert.notEqual(afterImage.revision, beforeImage.revision);
  const blueImage = await render({ ifNoneMatch: redImage.etag });
  assert.equal(blueImage.cache, 'MISS'); assert.notEqual(blueImage.hash, redImage.hash);
  assert.notEqual(blueImage.etag, redImage.etag);
  await data(db.storage.from('vote-images').remove([imagePath]));
  const deletedImage = await state();
  assert.equal(deletedImage.assets[imagePath], null);
  const withoutImage = await renderBracketImageWithAssets(await load(), deletedImage.assets);
  assert.equal(withoutImage.complete, false);
  assert.equal((withoutImage.svg.match(/<image /g) ?? []).length, 1, 'a deleted Storage object cannot reappear from an old CDN copy');
  await data(db.storage.from('vote-images').upload(imagePath, blue, { contentType: 'image/jpeg', upsert: true }));

  const old = await state();
  await data(db.from('candidates').update({ name: '另一位名称' }).eq('id', candidates[3]));
  const raced = await data(db.rpc('get_bracket_image_export_state', { p_group_id: group, p_tournament_id: tournament, p_include_snapshot: true, p_expected_revision: old.revision }));
  assert.equal(raced.snapshot, null, 'a changed MVCC snapshot cannot be labelled with the old cache revision');

  await data(db.from('contest_calling_sessions').insert({ id: session, contest_id: contests[0], seed: 'bracket-cache-test', status: 'draft', total_steps: 1 }));
  assert.equal((await state()).cacheable, false);
  assert.equal((await exportBracketImage({ caller: anon, groupId: group, tournamentId: tournament, prefetch: true })).kind, 'deferred');
  assert.equal((await validate(blueImage.etag, old.visibilityVersion)).kind, 'changed', 'upstream calling invalidates a prepared image');
  const masked = await load();
  const maskedFinal = masked.matches.find(m => m.round === 'final');
  assert.equal(maskedFinal.resultVisible, false); assert.equal(maskedFinal.left, null); assert.equal(maskedFinal.winnerEntryId, null);
  const hiddenExport = await exportBracketImage({ caller: anon, groupId: group, tournamentId: tournament, requestedVersion: old.visibilityVersion });
  assert.equal(hiddenExport.kind, 'changed');
  admin = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
  await data(admin.auth.signInWithPassword({ email: 'admin@buttervote.local', password: 'ButterVoteAdmin123!' }));
  assert.ok((await admin.rpc('get_bracket_image_export_state', { p_group_id: group })).error);
  assert.equal((await load(admin)).matches.find(m => m.round === 'final').resultVisible, false, 'administrator warmup cannot expose blocked results');
  await data(db.from('contest_calling_sessions').delete().eq('id', session));

  const liveVersion = (await state()).revision;
  await data(db.from('contests').update({ status: 'voting', live_results_enabled: true }).eq('id', contests[1]));
  assert.equal((await state()).cacheable, false);
  assert.notEqual((await state()).revision, liveVersion);
  assert.equal((await render({ ifNoneMatch: blueImage.etag })).etag, null, 'live vote totals cannot authorize browser reuse');
  await data(db.from('votes').insert({ contest_id: contests[1], voter_id: null, payload: { candidateId: candidates[2] } }));
  const live = await load();
  assert.equal(live.matches.find(m => m.round === 'final').left.score, 2, 'live base points exclude the love-vote multiplier');
  await data(db.from('contests').update({ status: 'published' }).eq('id', contests[1]));
  const beforeRevoke = await render();

  sql(`create policy "${policy}" on public.contest_groups as restrictive for select to anon using (id <> '${group}'::uuid);`);
  assert.deepEqual(await exportBracketImage({ caller: anon, groupId: group, tournamentId: tournament }), { kind: 'not-found' }, 'a warmed PNG cannot bypass current group RLS');
  assert.deepEqual(await validate(beforeRevoke.etag), { kind: 'not-found' }, 'prepared browser bytes cannot bypass current group RLS');
  sql(`drop policy "${policy}" on public.contest_groups;`);
  await data(db.from('contests').update({ archived_at: new Date().toISOString() }).eq('id', contests[0]));
  assert.equal((await state()).cacheable, false);
  assert.equal((await load()).matches.find(m => m.round === 'final').resultVisible, false);

  await mkdir('.local/share-bracket-perf', { recursive: true });
  const report = { passed: true, coldMs: cold.ms, hotMs: hot.ms, cases: ['aggregate scores', 'early cache', 'anonymous pregeneration', 'candidate rename', 'weight', 'vote edit', 'ranking', 'same-path storage overwrite', 'storage deletion', 'MVCC race', 'upstream calling', 'admin isolation', 'live base scores', 'group RLS revocation', 'source archive', 'bodyless revalidation', 'browser score invalidation', 'browser asset invalidation', 'browser permission revocation', 'speculation skips live results'] };
  await writeFile('.local/share-bracket-perf/integration.json', JSON.stringify(report, null, 2));
  if (keepFixture) {
    await data(db.from('contests').update({ archived_at: null }).eq('id', contests[0]));
    await writeFile('.local/share-bracket-perf/fixture.json', JSON.stringify({ group, tournament, contests, imagePath }, null, 2));
  }
  succeeded = true;
  console.log(JSON.stringify(report));
} finally {
  sql(`drop policy if exists "${policy}" on public.contest_groups;`);
  if (!keepFixture || !succeeded) {
    await db.storage.from('vote-images').remove([imagePath]);
    await db.from('contest_calling_sessions').delete().in('contest_id', contests);
    await db.from('tournaments').delete().eq('id', tournament);
    await db.from('contests').delete().in('id', contests);
    await db.from('contest_groups').delete().eq('id', group);
  }
  if (admin) { await admin.auth.signOut({ scope: 'local' }); await admin.removeAllChannels(); }
}
