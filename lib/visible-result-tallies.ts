import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase-pagination";
import type { Database } from "@/lib/types";
import { loadPublicResultSnapshots } from "@/lib/public-result-snapshots";
import { canonicalContestIds } from "@/lib/contest-ids";

type ResultDataClient = SupabaseClient<Database>;

export type VisibleContestTallyRow = {
  contest_id: string;
  candidate_id: string;
  score: number;
  normal_score: number;
  love_score: number;
  love_vote_count: number;
  last_vote_at: string | null;
};

export async function loadVisibleContestTallies(
  supabase: ResultDataClient,
  contestIds: readonly string[],
  options: { includeAdminOverride?: boolean; publishedContestIds?: readonly string[] } = {},
) {
  const uniqueContestIds = canonicalContestIds(contestIds);
  if (uniqueContestIds.length === 0) {
    return {
      tallies: [] as VisibleContestTallyRow[],
      error: null,
    };
  }

  const eligible = options.includeAdminOverride ? [] :
    canonicalContestIds(options.publishedContestIds ?? []).filter((id) => uniqueContestIds.includes(id));
  const read = (ids: string[]) => ids.length ? fetchAllRows<VisibleContestTallyRow>(() =>
    supabase.rpc("get_visible_contest_tallies", {
      p_contest_ids: ids,
      p_include_admin_override: options.includeAdminOverride ?? false,
    }, { count: "exact" }).order("contest_id", { ascending: true }).order("candidate_id", { ascending: true }),
  ) : Promise.resolve({ data: [] as VisibleContestTallyRow[], error: null });
  const livePromise = read(uniqueContestIds.filter((id) => !eligible.includes(id)));
  const snapshots = await loadPublicResultSnapshots(eligible);
  const [live, missed] = await Promise.all([livePromise, read(eligible.filter((id) => !snapshots.has(id)))]);
  const error = live.error ?? missed.error;

  if (error) {
    return {
      tallies: [] as VisibleContestTallyRow[],
      error,
    };
  }

  return {
    tallies: [...Array.from(snapshots.values()).flatMap((snapshot) => snapshot.tallies), ...(live.data ?? []), ...(missed.data ?? [])]
      .sort((a, b) => a.contest_id.localeCompare(b.contest_id) || a.candidate_id.localeCompare(b.candidate_id)),
    error: null,
  };
}
