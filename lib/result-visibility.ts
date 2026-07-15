import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  contestResultVisibilityFromRow,
  hiddenContestResultVisibility,
} from "@/lib/result-visibility-model";
import type { Database } from "@/lib/types";

export {
  contestResultVisibilityFromRow,
  hiddenContestResultVisibility,
  type ContestResultVisibility,
} from "@/lib/result-visibility-model";

type ResultVisibilityClient = SupabaseClient<Database>;

export async function loadContestResultVisibilityByContest(
  supabase: ResultVisibilityClient,
  contests: readonly { id: string }[],
  options: { includeAdminOverride?: boolean } = {},
) {
  const contestIds = [...new Set(contests.map((contest) => contest.id))];
  const failClosed = () =>
    new Map(
      contestIds.map(
        (contestId) =>
          [contestId, hiddenContestResultVisibility()] as const,
      ),
    );

  if (contestIds.length === 0) {
    return failClosed();
  }

  const { data, error } = await supabase.rpc(
    "get_contest_result_visibility",
    {
      p_contest_ids: contestIds,
      p_include_admin_override: options.includeAdminOverride ?? false,
    },
  );

  if (error) {
    console.error("Failed to load contest result visibility.", error.message);
    return failClosed();
  }

  const visibilityByContest = failClosed();
  for (const row of data ?? []) {
    visibilityByContest.set(
      row.contest_id,
      contestResultVisibilityFromRow(row),
    );
  }

  return visibilityByContest;
}
