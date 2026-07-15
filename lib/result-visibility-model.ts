import type {
  ContestResultVisibilityState as VisibilityState,
  Database,
} from "@/lib/types";

type ResultVisibilityRpcRow =
  Database["public"]["Functions"]["get_contest_result_visibility"]["Returns"][number];

export type ContestResultVisibility = {
  state: VisibilityState;
  fullResultsVisible: boolean;
  resultPageVisible: boolean;
  callingProgressVisible: boolean;
  fullResultsBlockedByCalling: boolean;
  showWeightedLoveScore: boolean;
  reason: string;
  callingSessionId: string | null;
  callingSessionStatus: string | null;
  visibilityVersion: string | null;
};

export function hiddenContestResultVisibility(): ContestResultVisibility {
  return {
    state: "hidden",
    fullResultsVisible: false,
    resultPageVisible: false,
    callingProgressVisible: false,
    fullResultsBlockedByCalling: false,
    showWeightedLoveScore: false,
    reason: "hidden",
    callingSessionId: null,
    callingSessionStatus: null,
    visibilityVersion: null,
  };
}

export function contestResultVisibilityFromRow(
  row: ResultVisibilityRpcRow,
): ContestResultVisibility {
  return {
    state: row.visibility_state,
    fullResultsVisible: row.full_results_visible === true,
    resultPageVisible: row.result_page_visible === true,
    callingProgressVisible: row.calling_progress_visible === true,
    fullResultsBlockedByCalling:
      row.full_results_blocked_by_calling === true,
    showWeightedLoveScore: row.show_weighted_love_score === true,
    reason: row.reason,
    callingSessionId: row.calling_session_id,
    callingSessionStatus: row.calling_session_status,
    visibilityVersion: row.visibility_version,
  };
}
