import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createVersionedArtifactCache } from "./versioned-artifact-cache";
import { pruneExpiredArtifacts } from "./artifact-maintenance";

function bucket() {
  // The ordinary local Next.js server has no Cloudflare bindings and uses the
  // same bounded memory cache. Production uses the existing private R2 bucket.
  try { return getCloudflareContext().env.NEXT_INC_CACHE_R2_BUCKET; }
  catch { return undefined; }
}

export const serverArtifacts = createVersionedArtifactCache({
  store: {
    async get(key, expectedRevision) {
      const object = await bucket()?.get(key);
      if (!object) return null;
      const revision = object.customMetadata?.revision;
      const expiresAt = Number(object.customMetadata?.expiresAt);
      if (revision !== expectedRevision || !Number.isFinite(expiresAt) || expiresAt <= Date.now() || object.size > 4 * 1024 * 1024) {
        await object.body.cancel();
        return null;
      }
      return { revision, expiresAt, bytes: new Uint8Array(await object.arrayBuffer()) };
    },
    async put(key, artifact) {
      await bucket()?.put(key, artifact.bytes, {
        customMetadata: { revision: artifact.revision, expiresAt: String(artifact.expiresAt) },
      });
    },
  },
});

export function scheduleArtifactMaintenance() {
  let context;
  try { context = getCloudflareContext(); } catch { return; }
  const storage = context.env.NEXT_INC_CACHE_R2_BUCKET;
  if (!storage) return;
  context.ctx.waitUntil(pruneExpiredArtifacts(storage).catch((error: unknown) => {
    console.warn("Artifact cache maintenance failed", error instanceof Error ? error.message : "cache error");
  }));
}
