import "server-only";
import { cache } from "react";
import { createPublicClient } from "@/lib/supabase/public";
import { fetchRowsByIds } from "@/lib/supabase-pagination";
import { serverArtifacts } from "@/lib/cache/server-artifacts";
import { createPublicSnapshotLoader } from "@/lib/public-result-snapshot-core";
import { canonicalContestIds } from "@/lib/contest-ids";

const load = createPublicSnapshotLoader({
  cache: serverArtifacts,
  async loadVersions(ids) {
    const client = createPublicClient();
    const result = await fetchRowsByIds(ids, (batch) => client.from("public_result_cache_versions")
      .select("contest_id,revision").in("contest_id", batch).order("contest_id"));
    if (result.error) throw new Error(`Public version read failed: ${result.error.message}`);
    return result.data ?? [];
  },
  async loadSnapshots(versions) {
    const { data, error } = await createPublicClient().rpc("get_public_result_snapshots", {
      p_contest_ids: versions.map((version) => version.contest_id),
      p_revisions: versions.map((version) => version.revision),
    });
    if (error) throw new Error(`Public snapshot read failed: ${error.message}`);
    return data;
  },
});
const loadByKey = cache((key: string) => load(key ? key.split(",") : []));
export function loadPublicResultSnapshots(contestIds: readonly string[]) {
  return loadByKey(canonicalContestIds(contestIds).sort().join(","));
}
