"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { ContestCallingStatus } from "@/lib/types";

export type ContestCallingRefreshWatch = {
  contestId: string;
  sessionId: string;
  status: ContestCallingStatus;
  currentStep: number;
  totalSteps: number;
  updatedAt: string | null;
};

type CallingSessionState = {
  id: string;
  contest_id: string;
  status: ContestCallingStatus;
  current_step: number;
  total_steps: number;
  updated_at: string | null;
};

const REFRESHABLE_STATUSES = new Set<ContestCallingStatus>(["active", "paused"]);

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : Number(value) || 0;
}

function shouldRefresh(
  expected: ContestCallingRefreshWatch,
  actual: CallingSessionState | null,
) {
  if (!actual) {
    return true;
  }

  return (
    actual.id !== expected.sessionId ||
    actual.status !== expected.status ||
    numberValue(actual.current_step) !== expected.currentStep ||
    numberValue(actual.total_steps) !== expected.totalSteps ||
    (expected.updatedAt !== null && actual.updated_at !== expected.updatedAt)
  );
}

export function ContestCallingAutoRefresh({
  watches,
  intervalMs = 1500,
}: {
  watches: ContestCallingRefreshWatch[];
  intervalMs?: number;
}) {
  const router = useRouter();
  const refreshCooldownRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const refreshableWatches = useMemo(
    () => watches.filter((watch) => REFRESHABLE_STATUSES.has(watch.status)),
    [watches],
  );

  useEffect(() => {
    if (refreshableWatches.length === 0) {
      return;
    }

    const supabase = createClient();
    const contestIds = Array.from(
      new Set(refreshableWatches.map((watch) => watch.contestId)),
    );
    let cancelled = false;

    async function checkCallingState() {
      if (cancelled || inFlightRef.current || refreshCooldownRef.current !== null) {
        return;
      }

      inFlightRef.current = true;
      const { data, error } = await supabase
        .from("contest_calling_sessions")
        .select("id,contest_id,status,current_step,total_steps,updated_at")
        .in("contest_id", contestIds)
        .is("archived_at", null)
        .in("status", ["active", "paused", "completed"])
        .order("created_at", { ascending: false });

      inFlightRef.current = false;

      if (cancelled || error) {
        return;
      }

      const latestByContestId = new Map<string, CallingSessionState>();
      for (const row of (data ?? []) as CallingSessionState[]) {
        if (!latestByContestId.has(row.contest_id)) {
          latestByContestId.set(row.contest_id, row);
        }
      }

      const changed = refreshableWatches.some((watch) =>
        shouldRefresh(watch, latestByContestId.get(watch.contestId) ?? null),
      );

      if (changed) {
        router.refresh();
        refreshCooldownRef.current = window.setTimeout(() => {
          refreshCooldownRef.current = null;
        }, Math.max(800, intervalMs));
      }
    }

    const interval = window.setInterval(checkCallingState, Math.max(800, intervalMs));
    const onFocus = () => void checkCallingState();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void checkCallingState();
      }
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    void checkCallingState();

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      if (refreshCooldownRef.current !== null) {
        window.clearTimeout(refreshCooldownRef.current);
        refreshCooldownRef.current = null;
      }
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [intervalMs, refreshableWatches, router]);

  return null;
}