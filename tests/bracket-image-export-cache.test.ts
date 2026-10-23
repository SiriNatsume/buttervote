import assert from "node:assert/strict";
import test from "node:test";
import { createBracketImageExporter, type BracketExportState } from "../lib/bracket-image/export-core.ts";
import { createVersionedArtifactCache, type Artifact } from "../lib/cache/versioned-artifact-cache.ts";

const png = (value: number) => { const bytes = new Uint8Array(40); bytes.set([137, 80, 78, 71]); bytes[39] = value; return bytes; };
const initial = (): BracketExportState => ({
  groupId: "group", groupName: "赛事", tournamentId: "tournament", revision: "a".repeat(64),
  cacheable: true, visibilityVersion: "123", assets: {},
});

function harness(store?: Map<string, Artifact>) {
  let state = initial();
  let allowed = true;
  let unavailable = false;
  let builds = 0;
  let guards = 0;
  let checks = 0;
  let onBuild: (() => Promise<void>) | undefined;
  let onRead: (() => Promise<void>) | undefined;
  let onWrite: (() => Promise<void>) | undefined;
  let complete = true;
  const cache = createVersionedArtifactCache(store ? { store: {
    get: async (key) => store.get(key) ?? null, put: async (key, value) => { store.set(key, value); },
  } } : {});
  const run = createBracketImageExporter<string>({
    cache: { ...cache,
      async read(...args) { const value = await cache.read(...args); await onRead?.(); return value; },
      async write(...args) { await cache.write(...args); await onWrite?.(); },
    },
    authorize: async () => { checks++; return allowed; },
    loadState: async () => { guards++; if (unavailable) throw new Error("guard unavailable"); return structuredClone(state); },
    build: async (snapshot) => {
      builds++; const value = builds;
      await onBuild?.();
      return { png: png(value), complete, visibilityVersion: snapshot.visibilityVersion };
    },
  });
  return {
    run: (version: string | undefined = "123") => run({ caller: "visitor", groupId: "group", requestedVersion: version }),
    stats: () => ({ builds, guards, checks }),
    state: (value: Partial<BracketExportState>) => { state = { ...state, ...value }; },
    allowed: (value: boolean) => { allowed = value; },
    unavailable: () => { unavailable = true; },
    onBuild: (callback: () => Promise<void>) => { onBuild = callback; },
    onRead: (callback: () => Promise<void>) => { onRead = callback; },
    onWrite: (callback: () => Promise<void>) => { onWrite = callback; },
    incomplete: () => { complete = false; },
  };
}

test("a hot image skips the builder while rechecking current access and DB state", async () => {
  const h = harness();
  const first = await h.run();
  const second = await h.run();
  assert.equal(first.kind === "ready" && first.cache, "MISS");
  assert.equal(second.kind === "ready" && second.cache, "HIT");
  assert.deepEqual(h.stats(), { builds: 1, guards: 5, checks: 5 });
});

test("score and same-path image revisions immediately replace one private cache slot across isolates", async () => {
  const store = new Map<string, Artifact>();
  const first = harness(store);
  await first.run();
  const freshIsolate = harness(store);
  const hit = await freshIsolate.run();
  assert.equal(hit.kind === "ready" && hit.cache, "HIT");
  assert.equal(freshIsolate.stats().builds, 0);
  for (const revision of ["vote-edit", "avatar-overwrite", "group-weight", "candidate-rename"]) {
    freshIsolate.state({ revision });
    const result = await freshIsolate.run();
    assert.equal(result.kind === "ready" && result.cache, "MISS");
    assert.equal(store.size, 1);
  }
});

test("revoked group access and a failed version guard never authorize a warm image", async () => {
  const h = harness();
  await h.run();
  h.allowed(false);
  assert.deepEqual(await h.run(), { kind: "not-found" });
  h.allowed(true); h.unavailable();
  await assert.rejects(h.run(), /guard unavailable/);
  assert.equal(h.stats().builds, 1);
});

test("calling or live states bypass a previously warmed complete-results image", async () => {
  const h = harness();
  await h.run();
  h.state({ cacheable: false, revision: "calling-draft" });
  for (let i = 0; i < 2; i++) {
    const result = await h.run();
    assert.equal(result.kind === "ready" && result.cache, "LIVE");
  }
  assert.equal(h.stats().builds, 3, "live votes cannot reuse an earlier image with an unchanged structural version");
});

test("permission revocation or a score edit during a cold render prevents returning or caching its old bytes", async () => {
  const revoked = harness();
  revoked.onBuild(async () => { revoked.allowed(false); });
  assert.deepEqual(await revoked.run(), { kind: "not-found" });
  const edited = harness();
  edited.onBuild(async () => { edited.state({ revision: "changed-during-render" }); });
  assert.deepEqual(await edited.run(), { kind: "changed" });
  edited.onBuild(async () => {});
  const next = await edited.run();
  assert.equal(next.kind === "ready" && next.cache, "MISS");
});

test("a revocation during a slow R2 cache read is checked again before returning its bytes", async () => {
  const h = harness(); await h.run();
  h.onRead(async () => { h.allowed(false); });
  assert.deepEqual(await h.run(), { kind: "not-found" });
  assert.equal(h.stats().builds, 1);
});

test("a revocation during a slow R2 write cannot return the just-generated old image", async () => {
  const h = harness(); h.onWrite(async () => { h.allowed(false); });
  assert.deepEqual(await h.run(), { kind: "not-found" });
});

test("concurrent identical stable requests share rendering and each caller is checked afterward", async () => {
  const h = harness();
  let release!: () => void;
  const blocker = new Promise<void>((resolve) => { release = resolve; });
  h.onBuild(() => blocker);
  const requests = [h.run(), h.run()];
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(h.stats().builds, 1);
  release();
  const results = await Promise.all(requests);
  assert.ok(results.every((result) => result.kind === "ready"));
  assert.equal(h.stats().checks, 6);
});

test("missing assets are not persisted in the early cache and a stale page version is rejected", async () => {
  const h = harness(); h.incomplete();
  await h.run();
  const next = await h.run();
  assert.equal(next.kind === "ready" && next.cache, "MISS");
  assert.equal(h.stats().builds, 2);
  assert.deepEqual(await h.run("old-version"), { kind: "changed" });
  assert.equal(h.stats().builds, 2);
});
