import assert from "node:assert/strict";
import {
  contestResultVisibilityFromRow,
  hiddenContestResultVisibility,
} from "../lib/result-visibility-model.ts";

const callingProgress = contestResultVisibilityFromRow({
  contest_id: "contest-1",
  visibility_state: "calling_progress",
  result_page_visible: true,
  full_results_visible: false,
  calling_progress_visible: true,
  full_results_blocked_by_calling: true,
  show_weighted_love_score: false,
  reason: "calling_in_progress",
  calling_session_id: "session-1",
  calling_session_status: "active",
  visibility_version: "2026-07-15T00:00:00.000Z",
});

assert.equal(callingProgress.state, "calling_progress");
assert.equal(callingProgress.resultPageVisible, true);
assert.equal(callingProgress.fullResultsVisible, false);
assert.equal(callingProgress.callingProgressVisible, true);
assert.equal(callingProgress.fullResultsBlockedByCalling, true);
assert.equal(callingProgress.showWeightedLoveScore, false);

const published = contestResultVisibilityFromRow({
  contest_id: "contest-1",
  visibility_state: "full",
  result_page_visible: true,
  full_results_visible: true,
  calling_progress_visible: false,
  full_results_blocked_by_calling: false,
  show_weighted_love_score: true,
  reason: "published",
  calling_session_id: "session-1",
  calling_session_status: "completed",
  visibility_version: "2026-07-15T00:01:00.000Z",
});

assert.equal(published.state, "full");
assert.equal(published.fullResultsVisible, true);
assert.equal(published.showWeightedLoveScore, true);

const hidden = hiddenContestResultVisibility();
assert.equal(hidden.state, "hidden");
assert.equal(hidden.resultPageVisible, false);
assert.equal(hidden.fullResultsVisible, false);
assert.equal(hidden.callingSessionId, null);

console.log("result visibility adapter tests passed");
