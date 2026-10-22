import assert from "node:assert/strict";
import test from "node:test";
import { createPublicSnapshotLoader, type PublicResultSnapshot } from "../lib/public-result-snapshot-core.ts";
import { createVersionedArtifactCache } from "../lib/cache/versioned-artifact-cache.ts";

const id = "11111111-1111-4111-8111-111111111111";
const revision = "22222222-2222-4222-8222-222222222222";
const nextRevision = "33333333-3333-4333-8333-333333333333";
const snapshot: PublicResultSnapshot = { contestId: id, revision, candidates: [], tallies: [] };

test("UUID case variants share a single canonical public snapshot", async () => {
  const lower = "abcdefab-1111-4111-8111-111111111111";
  let reads = 0;
  const load = createPublicSnapshotLoader({ cache: createVersionedArtifactCache(),
    loadVersions: async (ids) => { assert.deepEqual(ids, [lower]); return [{contest_id:lower,revision}]; },
    loadSnapshots: async () => { reads += 1; return [{...snapshot,contestId:lower}]; },
  });
  assert.equal((await load([lower.toUpperCase(),lower])).size,1);
  assert.equal((await load([lower])).size,1);
  assert.equal(reads,1);
});

test("every cache hit rechecks current publication, permissions and revision", async () => {
  let allowed = true;
  let current = revision;
  let checks = 0;
  let reads = 0;
  const load = createPublicSnapshotLoader({
    cache: createVersionedArtifactCache(),
    loadVersions: async () => { checks += 1; return allowed ? [{ contest_id: id, revision: current }] : []; },
    loadSnapshots: async () => { reads += 1; return [{ ...snapshot, revision: current }]; },
  });
  assert.equal((await load([id, id])).get(id)?.revision, revision);
  await load([id]);
  assert.equal(checks, 2);
  assert.equal(reads, 1);
  allowed = false;
  assert.equal((await load([id])).size, 0); // warm private R2 bytes cannot authorize a read
  allowed = true;
  current = nextRevision;
  assert.equal((await load([id])).get(id)?.revision, nextRevision);
  assert.equal(reads, 2);
});

test("guard failures fail closed, even after a successful warm read", async () => {
  let fail = false;
  const warnings: string[] = [];
  const load = createPublicSnapshotLoader({
    cache: createVersionedArtifactCache(), warn: (message) => warnings.push(message),
    loadVersions: async () => { if (fail) throw new Error("guard unavailable"); return [{ contest_id: id, revision }]; },
    loadSnapshots: async () => [snapshot],
  });
  assert.equal((await load([id])).size, 1);
  fail = true;
  assert.equal((await load([id])).size, 0);
  assert.deepEqual(warnings, ["guard unavailable"]);
});

test("a mutation/revocation between guard and snapshot is not cached", async () => {
  let races = true;
  let reads = 0;
  const load = createPublicSnapshotLoader({
    cache: createVersionedArtifactCache(), warn: () => {},
    loadVersions: async () => [{ contest_id: id, revision }],
    loadSnapshots: async () => { reads += 1; return races ? [] : [snapshot]; },
  });
  assert.equal((await load([id])).size, 0);
  races = false;
  assert.equal((await load([id])).size, 1);
  assert.equal(reads, 2);
});

test("corrupt cache data is replaced and cross-contest snapshots are rejected", async () => {
  const cache = createVersionedArtifactCache();
  await cache.write("public-results-v1", id, revision, new TextEncoder().encode("broken JSON"), 10000);
  let reads = 0;
  let invalid = false;
  const load = createPublicSnapshotLoader({
    cache, warn: () => {}, loadVersions: async () => [{ contest_id: id, revision }],
    loadSnapshots: async () => { reads += 1; return [{ ...snapshot, contestId: invalid ? nextRevision : id }]; },
  });
  assert.equal((await load([id])).size, 1);
  assert.equal(reads, 1);
  const fresh = createPublicSnapshotLoader({ cache: createVersionedArtifactCache(), warn: () => {},
    loadVersions: async () => [{ contest_id: id, revision }], loadSnapshots: async () => [{ ...snapshot, contestId: nextRevision }],
  });
  invalid = true;
  assert.equal((await fresh([id])).size, 0);
});
