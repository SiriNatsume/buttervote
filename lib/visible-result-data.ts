import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase-pagination";
import type { Database, Json } from "@/lib/types";

type ResultDataClient = SupabaseClient<Database>;

export type VisibleVoteRow = {
  id: string;
  contest_id: string;
  payload: Json;
  created_at: string;
};

export type VisibleLoveVoteRow = {
  contest_id: string;
  vote_id: string;
  candidate_id: string;
};

export async function loadVisibleContestResultData(
  supabase: ResultDataClient,
  contestIds: readonly string[],
  options: { includeAdminOverride?: boolean } = {},
) {
  const uniqueContestIds = [...new Set(contestIds)];

  if (uniqueContestIds.length === 0) {
    return {
      votes: [] as VisibleVoteRow[],
      loveAllocations: [] as VisibleLoveVoteRow[],
      error: null,
    };
  }

  const args = {
    p_contest_ids: uniqueContestIds,
    p_include_admin_override: options.includeAdminOverride ?? false,
  };
  const [voteResult, loveResult] = await Promise.all([
    fetchAllRows<VisibleVoteRow>(() =>
      supabase.rpc("get_visible_contest_vote_payloads", args),
    ),
    fetchAllRows<VisibleLoveVoteRow>(() =>
      supabase.rpc("get_visible_contest_love_vote_allocations", args),
    ),
  ]);
  const error = voteResult.error ?? loveResult.error;

  if (error) {
    return {
      votes: [] as VisibleVoteRow[],
      loveAllocations: [] as VisibleLoveVoteRow[],
      error,
    };
  }

  return {
    votes: voteResult.data ?? [],
    loveAllocations: loveResult.data ?? [],
    error: null,
  };
}
