import assert from "node:assert/strict";
import test from "node:test";
import { artifactDigest, createVersionedArtifactCache, type Artifact, type ArtifactStore } from "../lib/cache/versioned-artifact-cache.ts";

const bytes = (value: string) => new TextEncoder().encode(value);
test("memory/R2 hits require the exact revision and expire; each owner overwrites one slot", async () => {
  let now = 0;
  let creates = 0;
  const objects = new Map<string, Artifact>();
  const store: ArtifactStore = { get: async (key) => objects.get(key) ?? null, put: async (key, artifact) => { objects.set(key, artifact); } };
  const first = createVersionedArtifactCache({ store, now: () => now });
  const create = async () => { creates += 1; return bytes(String(creates)); };
  assert.deepEqual(await first.getOrCreate("png", "contest", "v1", create, 100), bytes("1"));
  await first.getOrCreate("png", "contest", "v1", create, 100);
  const second = createVersionedArtifactCache({ store, now: () => now });
  assert.deepEqual(await second.getOrCreate("png", "contest", "v1", create, 100), bytes("1"));
  assert.equal(creates, 1);
  await second.getOrCreate("png", "contest", "v2", create, 100);
  assert.equal(creates, 2);
  assert.equal(objects.size, 1);
  now = 101;
  await second.getOrCreate("png", "contest", "v2", create, 100);
  assert.equal(creates, 3);
  await second.getOrCreate("public", "contest", "v2", create, 100);
  assert.equal(objects.size, 2); // namespaces cannot collide
});

test("simultaneous identical renders share work, and failed renders are retried", async () => {
  const cache = createVersionedArtifactCache();
  let creates = 0;
  let finish!: (bytes: Uint8Array) => void;
  const create = async () => { creates += 1; return new Promise<Uint8Array>((resolve) => { finish = resolve; }); };
  const pending = [cache.getOrCreate("png", "owner", "v1", create), cache.getOrCreate("png", "owner", "v1", create)];
  await Promise.resolve(); await Promise.resolve();
  finish(bytes("image"));
  assert.deepEqual(await Promise.all(pending), [bytes("image"), bytes("image")]);
  assert.equal(creates, 1);
  await assert.rejects(cache.getOrCreate("png", "owner", "v2", async () => { throw new Error("render failed"); }));
  assert.deepEqual(await cache.getOrCreate("png", "owner", "v2", async () => bytes("retry")), bytes("retry"));
});

test("optional storage failures do not hide rendering errors or serve an older revision", async () => {
  const warnings: unknown[] = [];
  const cache = createVersionedArtifactCache({ store: {
    get: async () => { throw new Error("R2 unavailable"); }, put: async () => { throw new Error("R2 unavailable"); },
  }, warn: (error) => warnings.push(error) });
  assert.deepEqual(await cache.getOrCreate("png", "owner", "v1", async () => bytes("one")), bytes("one"));
  assert.deepEqual(await cache.getOrCreate("png", "owner", "v2", async () => bytes("two")), bytes("two"));
  assert.equal(warnings.length, 4);
  await assert.rejects(cache.getOrCreate("png", "owner", "v3", async () => { throw new Error("real render failure"); }), /real render failure/);
});

test("memory has byte and entry bounds and oversized images are never persisted", async () => {
  const cache = createVersionedArtifactCache({ maxMemoryBytes: 5, maxEntryBytes: 4 });
  await cache.write("a", "first", "v", bytes("123"), 1000);
  await cache.write("a", "second", "v", bytes("456"), 1000);
  assert.equal(await cache.read("a", "first", "v"), null);
  assert.deepEqual(await cache.read("a", "second", "v"), bytes("456"));
  await cache.write("a", "large", "v", bytes("12345"), 1000);
  assert.equal(await cache.read("a", "large", "v"), null);
});

test("old/new concurrent writes can only cause a miss, never a wrong-version hit", async () => {
  const objects = new Map<string, Artifact>();
  const cache = createVersionedArtifactCache({ store: { get: async (key) => objects.get(key) ?? null, put: async (key, artifact) => { objects.set(key, artifact); } } });
  await cache.write("a", "owner", "v2", bytes("new"), 1000);
  await cache.write("a", "owner", "v1", bytes("old"), 1000);
  assert.equal(await cache.read("a", "owner", "v2"), null);
  assert.notEqual(await artifactDigest("step 1"), await artifactDigest("step 2"));
  assert.equal(await artifactDigest("step 1"), await artifactDigest("step 1"));
});
