import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase-pagination";
import type { Database } from "@/lib/types";

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
  options: { includeAdminOverride?: boolean } = {},
) {
  const uniqueContestIds = [...new Set(contestIds)];
  if (uniqueContestIds.length === 0) {
    return {
      tallies: [] as VisibleContestTallyRow[],
      error: null,
    };
  }

  const result = await fetchAllRows<VisibleContestTallyRow>(() =>
    supabase.rpc("get_visible_contest_tallies", {
      p_contest_ids: uniqueContestIds,
      p_include_admin_override: options.includeAdminOverride ?? false,
    }),
  );

  if (result.error) {
    return {
      tallies: [] as VisibleContestTallyRow[],
      error: result.error,
    };
  }

  return {
    tallies: result.data ?? [],
    error: null,
  };
}
