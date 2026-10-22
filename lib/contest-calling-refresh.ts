import type { ContestCallingStatus } from "./types";

export type ContestCallingRefreshWatch = {
  contestId: string;
  sessionId: string;
  status: ContestCallingStatus;
  currentStep: number;
  totalSteps: number;
  updatedAt: string | null;
};

export type CallingSessionState = {
  id: string;
  contest_id: string;
  status: ContestCallingStatus;
  current_step: number;
  total_steps: number;
  updated_at: string | null;
};

export const CALLING_REFRESH_EVENT = "calling_changed";
export const CALLING_RECONCILE_INTERVAL_MS = 15_000;
export const CALLING_CHECK_TIMEOUT_MS = 10_000;

export function callingRefreshTopic(contestId: string) {
  return `buttervote:calling:${contestId}`;
}

export function isCallingRefreshable(status: ContestCallingStatus) {
  return status === "draft" || status === "active" || status === "paused";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : Number(value) || 0;
}

export function hasCallingStateChanged(
  watches: readonly ContestCallingRefreshWatch[],
  rows: readonly CallingSessionState[],
) {
  // The query orders newest first, matching the result pages' session selection.
  const latest = new Map<string, CallingSessionState>();
  for (const row of rows) {
    if (!latest.has(row.contest_id)) latest.set(row.contest_id, row);
  }

  return watches.some((watch) => {
    const actual = latest.get(watch.contestId);
    return !actual || actual.id !== watch.sessionId || actual.status !== watch.status ||
      numberValue(actual.current_step) !== watch.currentStep ||
      numberValue(actual.total_steps) !== watch.totalSteps ||
      (watch.updatedAt !== null && actual.updated_at !== watch.updatedAt);
  });
}

/** One batch read at a time; broadcasts are hints, never trusted result data. */
export function createCallingRefreshController({
  getWatches,
  readState,
  refresh,
  intervalMs = 1500,
}: {
  getWatches: () => readonly ContestCallingRefreshWatch[];
  readState: (signal: AbortSignal) => Promise<readonly CallingSessionState[] | null>;
  refresh: () => void;
  intervalMs?: number;
}) {
  const fallbackInterval = Math.max(800, intervalMs);
  let active = false;
  let disposed = false;
  let connected = false;
  let readFailed = false;
  let refreshing = false;
  let queued = false;
  let request: AbortController | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  function schedulePoll() {
    clearTimeout(pollTimer);
    if (!active || disposed) return;
    pollTimer = setTimeout(() => {
      checkNow();
      schedulePoll();
    }, connected && !readFailed ? CALLING_RECONCILE_INTERVAL_MS : fallbackInterval);
  }

  async function check() {
    if (!active || disposed || request || refreshing || !queued) return;
    queued = false;
    const currentRequest = new AbortController();
    request = currentRequest;
    const timeout = setTimeout(() => currentRequest.abort(), CALLING_CHECK_TIMEOUT_MS);
    let rows: readonly CallingSessionState[] | null = null;
    try {
      rows = await readState(currentRequest.signal);
    } catch {
      // Network failures use the same fast fallback as a lost subscription.
    } finally {
      clearTimeout(timeout);
    }
    if (disposed || request !== currentRequest) return;
    request = null;
    const failed = rows === null;
    if (failed !== readFailed) {
      readFailed = failed;
      schedulePoll();
    }
    if (rows && active && hasCallingStateChanged(getWatches(), rows)) {
      refreshing = true;
      refresh();
    }
    if (queued) debounceCheck();
  }

  function debounceCheck() {
    if (!active || disposed || debounceTimer !== undefined || request || refreshing) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      void check();
    }, 100);
  }

  function checkNow() {
    if (!active || disposed) return;
    queued = true;
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
    void check();
  }

  return {
    checkNow,
    notifyChange() {
      if (!active || disposed) return;
      queued = true;
      debounceCheck();
    },
    setConnected(value: boolean) {
      if (disposed || connected === value) return;
      connected = value;
      schedulePoll();
      // Covers both a missed event during reconnect and loss of the socket.
      checkNow();
    },
    setRefreshing(value: boolean) {
      refreshing = value;
      if (!value && queued) checkNow();
    },
    setActive(value: boolean) {
      if (disposed || active === value) return;
      active = value;
      clearTimeout(pollTimer);
      clearTimeout(debounceTimer);
      debounceTimer = undefined;
      if (!value) {
        request?.abort();
        request = null;
        queued = false;
      } else {
        checkNow();
        schedulePoll();
      }
    },
    dispose() {
      disposed = true;
      request?.abort();
      request = null;
      clearTimeout(pollTimer);
      clearTimeout(debounceTimer);
    },
  };
}
