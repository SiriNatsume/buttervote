export type Artifact = { revision: string; expiresAt: number; bytes: Uint8Array };
export type ArtifactStore = {
  get: (key: string, revision: string) => Promise<Artifact | null>;
  put: (key: string, artifact: Artifact) => Promise<void>;
};

/** Private, bounded slots. A version mismatch is always a miss, never stale data. */
export function createVersionedArtifactCache({
  store,
  now = Date.now,
  maxMemoryBytes = 8 * 1024 * 1024,
  maxEntryBytes = 4 * 1024 * 1024,
  warn = (error: unknown) => console.warn("Optional artifact cache unavailable", error instanceof Error ? error.message : "cache error"),
}: { store?: ArtifactStore; now?: () => number; maxMemoryBytes?: number; maxEntryBytes?: number; warn?: (error: unknown) => void } = {}) {
  const memory = new Map<string, Artifact>();
  const pending = new Map<string, Promise<Uint8Array>>();
  let memoryBytes = 0;
  const keyFor = (namespace: string, owner: string) => `buttervote-artifacts/${encodeURIComponent(namespace)}/${encodeURIComponent(owner)}`;

  function remember(key: string, artifact: Artifact) {
    const previous = memory.get(key);
    if (previous) memoryBytes -= previous.bytes.byteLength;
    memory.delete(key);
    if (artifact.bytes.byteLength > Math.min(maxEntryBytes, maxMemoryBytes)) return;
    memory.set(key, artifact);
    memoryBytes += artifact.bytes.byteLength;
    while (memoryBytes > maxMemoryBytes || memory.size > 128) {
      const oldest = memory.keys().next().value;
      if (oldest === undefined) break;
      memoryBytes -= memory.get(oldest)!.bytes.byteLength;
      memory.delete(oldest);
    }
  }

  async function read(namespace: string, owner: string, revision: string) {
    const key = keyFor(namespace, owner);
    const local = memory.get(key);
    if (local?.revision === revision && local.expiresAt > now()) {
      remember(key, local);
      return local.bytes;
    }
    if (!store) return null;
    try {
      const remote = await store.get(key, revision);
      if (remote?.revision !== revision || remote.expiresAt <= now() || remote.bytes.byteLength > maxEntryBytes) return null;
      remember(key, remote);
      return remote.bytes;
    } catch (error) {
      warn(error);
      return null;
    }
  }

  async function write(namespace: string, owner: string, revision: string, bytes: Uint8Array, ttlMs: number) {
    if (bytes.byteLength > maxEntryBytes) return;
    const key = keyFor(namespace, owner);
    const artifact = { revision, bytes, expiresAt: now() + ttlMs };
    remember(key, artifact);
    try { await store?.put(key, artifact); } catch (error) { warn(error); }
  }

  async function getOrCreate(namespace: string, owner: string, revision: string, create: () => Promise<Uint8Array>, ttlMs = 3_600_000) {
    const key = `${keyFor(namespace, owner)}:${revision}`;
    const existing = pending.get(key);
    if (existing) return existing;
    const promise = (async () => {
      const hit = await read(namespace, owner, revision);
      if (hit) return hit;
      const bytes = await create();
      await write(namespace, owner, revision, bytes, ttlMs);
      return bytes;
    })();
    pending.set(key, promise);
    try { return await promise; } finally { pending.delete(key); }
  }

  return { read, write, getOrCreate };
}

export async function artifactDigest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
