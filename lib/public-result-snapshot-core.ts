import { z } from "zod";
import type { createVersionedArtifactCache } from "./cache/versioned-artifact-cache";
import { canonicalContestIds } from "./contest-ids";

const candidate = z.object({
  id: z.string().uuid(), contest_id: z.string().uuid(), name: z.string(),
  description: z.string().nullable(), image_path: z.string().nullable(),
  nominator_display_name: z.string().nullable(), is_active: z.boolean(), created_at: z.string(),
});
const tally = z.object({
  contest_id: z.string().uuid(), candidate_id: z.string().uuid(), score: z.number().finite(),
  normal_score: z.number().finite(), love_score: z.number().finite(), love_vote_count: z.number().int().nonnegative(),
  last_vote_at: z.string().nullable(),
});
const snapshotSchema = z.object({
  contestId: z.string().uuid(), revision: z.string().uuid(), candidates: z.array(candidate), tallies: z.array(tally),
}).refine((snapshot) => snapshot.candidates.every((row) => row.contest_id === snapshot.contestId && row.is_active)
  && snapshot.tallies.every((row) => row.contest_id === snapshot.contestId));
export type PublicResultSnapshot = z.infer<typeof snapshotSchema>;
export type PublicResultVersion = { contest_id: string; revision: string };

export function createPublicSnapshotLoader({ loadVersions, loadSnapshots, cache, warn = console.warn }: {
  loadVersions: (ids: string[]) => Promise<PublicResultVersion[]>;
  loadSnapshots: (versions: PublicResultVersion[]) => Promise<unknown>;
  cache: Pick<ReturnType<typeof createVersionedArtifactCache>, "read" | "write">;
  warn?: (message: string) => void;
}) {
  return async (contestIds: readonly string[]) => {
    const result = new Map<string, PublicResultSnapshot>();
    const ids = canonicalContestIds(contestIds).sort();
    if (!ids.length) return result;
    try {
      // Mandatory on every request, including memory/R2 hits. This RLS read is
      // the current publication, calling and inherited-visibility check.
      const versions = await loadVersions(ids);
      const missing: PublicResultVersion[] = [];
      await Promise.all(versions.filter((version) => ids.includes(version.contest_id)).map(async (version) => {
        const bytes = await cache.read("public-results-v1", version.contest_id, version.revision);
        if (bytes) {
          let value: unknown;
          try { value = JSON.parse(new TextDecoder().decode(bytes)); }
          catch { value = null; }
          const parsed = snapshotSchema.safeParse(value);
          if (parsed.success && parsed.data.contestId === version.contest_id && parsed.data.revision === version.revision) {
            result.set(version.contest_id, parsed.data);
            return;
          }
        }
        missing.push(version);
      }));
      for (let offset = 0; offset < missing.length; offset += 100) {
        const batch = missing.slice(offset, offset + 100);
        const snapshots = z.array(snapshotSchema).parse(await loadSnapshots(batch));
        const byId = new Map(snapshots.map((snapshot) => [snapshot.contestId, snapshot]));
        if (snapshots.length !== batch.length || batch.some((version) => byId.get(version.contest_id)?.revision !== version.revision)) {
          throw new Error("Public result snapshot changed during loading");
        }
        await Promise.all(batch.map(async (version) => {
          const snapshot = byId.get(version.contest_id)!;
          result.set(version.contest_id, snapshot);
          await cache.write("public-results-v1", version.contest_id, version.revision,
            new TextEncoder().encode(JSON.stringify(snapshot)), 3_600_000);
        }));
      }
    } catch (error) {
      // Never use unchecked cache entries after a guard failure. Callers fall
      // back to their ordinary RLS-protected reads for any missing contest.
      warn(error instanceof Error ? error.message : "Public snapshot unavailable");
    }
    return result;
  };
}
