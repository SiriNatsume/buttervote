import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types";
import { fetchRowsByIds } from "@/lib/supabase-pagination";
import { loadPublicResultSnapshots } from "@/lib/public-result-snapshots";
import { canonicalContestIds } from "@/lib/contest-ids";

export async function loadResultCandidates(client: SupabaseClient<Database>, contestIds: readonly string[], options: {
  publishedContestIds?: readonly string[]; includeInactive?: boolean;
} = {}) {
  const ids = canonicalContestIds(contestIds);
  const eligible = options.includeInactive ? [] : canonicalContestIds(options.publishedContestIds ?? []).filter((id) => ids.includes(id));
  const read = (requested: string[]) => fetchRowsByIds(requested, (batch) => {
    const query = client.from("candidates")
      .select("id,contest_id,name,description,image_path,nominator_display_name,is_active,created_at", { count: "exact" })
      .in("contest_id", batch).order("created_at").order("id");
    return options.includeInactive ? query : query.eq("is_active", true);
  });
  // Live contests start immediately; a historical-cache lookup cannot delay them.
  const live = read(ids.filter((id) => !eligible.includes(id)));
  const snapshots = await loadPublicResultSnapshots(eligible);
  const [liveRows, missedRows] = await Promise.all([live, read(eligible.filter((id) => !snapshots.has(id)))]);
  const error = liveRows.error ?? missedRows.error;
  return {
    data: error ? null : [...Array.from(snapshots.values()).flatMap((snapshot) => snapshot.candidates),
      ...(liveRows.data ?? []), ...(missedRows.data ?? [])].sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id)),
    error,
  };
}
