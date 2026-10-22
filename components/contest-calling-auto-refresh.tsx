"use client";

import { useEffect, useMemo, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  CALLING_REFRESH_EVENT,
  callingRefreshTopic,
  createCallingRefreshController,
  isCallingRefreshable,
  type ContestCallingRefreshWatch,
} from "@/lib/contest-calling-refresh";

export type { ContestCallingRefreshWatch } from "@/lib/contest-calling-refresh";

// Navigation may mount a new result-page component before the old channels have
// finished leaving. The browser client is shared, so track its cleanup across mounts.
const pendingChannelRemovals = new WeakMap<ReturnType<typeof createClient>, Promise<void>>();

export function ContestCallingAutoRefresh({
  watches,
  intervalMs = 1500,
}: {
  watches: ContestCallingRefreshWatch[];
  intervalMs?: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const controllerRef = useRef<ReturnType<typeof createCallingRefreshController> | null>(null);
  const watchesRef = useRef(watches);
  const pendingRef = useRef(isPending);
  const refreshableWatches = useMemo(
    () => watches.filter((watch) => isCallingRefreshable(watch.status)),
    [watches],
  );
  // A new step updates the expected snapshot without reconnecting every channel.
  const contestIdsKey = Array.from(new Set(refreshableWatches.map((watch) => watch.contestId)))
    .sort().join(",");

  useEffect(() => {
    watchesRef.current = refreshableWatches;
  }, [refreshableWatches]);

  useEffect(() => {
    pendingRef.current = isPending;
    controllerRef.current?.setRefreshing(isPending);
  }, [isPending]);

  useEffect(() => {
    if (!contestIdsKey) return;
    const contestIds = contestIdsKey.split(",");
    const supabase = createClient();
    const controller = createCallingRefreshController({
      getWatches: () => watchesRef.current,
      readState: async (signal) => {
        const { data, error } = await supabase
          .from("contest_calling_sessions")
          .select("id,contest_id,status,current_step,total_steps,updated_at")
          .in("contest_id", contestIds)
          .is("archived_at", null)
          .in("status", ["draft", "active", "paused", "completed"])
          .order("created_at", { ascending: false })
          .abortSignal(signal);
        return error ? null : data;
      },
      refresh: () => startTransition(() => router.refresh()),
      intervalMs,
    });
    controllerRef.current = controller;
    controller.setRefreshing(pendingRef.current);
    let channels: ReturnType<typeof supabase.channel>[] = [];
    let generation = 0;

    function unsubscribe() {
      generation += 1;
      const previous = channels;
      channels = [];
      controller.setConnected(false);
      if (previous.length) {
        const removal = Promise.allSettled([
          pendingChannelRemovals.get(supabase),
          ...previous.map((channel) => supabase.removeChannel(channel)),
        ]).then(() => undefined);
        pendingChannelRemovals.set(supabase, removal);
      }
    }

    async function subscribe() {
      if (channels.length) return;
      const currentGeneration = ++generation;
      // The SDK reuses same-topic channels until removal finishes. Wait before
      // rejoining after a quick hide/show, rather than subscribing an old channel.
      await pendingChannelRemovals.get(supabase);
      if (generation !== currentGeneration) return;
      const subscribed = new Set<string>();
      channels = contestIds.map((contestId) => supabase.channel(callingRefreshTopic(contestId), {
        config: { private: true },
      }));
      channels.forEach((channel, index) => {
        const contestId = contestIds[index];
        channel
          .on("broadcast", { event: CALLING_REFRESH_EVENT }, () => {
            if (generation === currentGeneration) controller.notifyChange();
          })
          .subscribe((status) => {
            if (generation !== currentGeneration) return;
            if (status === "SUBSCRIBED") subscribed.add(contestId);
            else subscribed.delete(contestId);
            controller.setConnected(subscribed.size === contestIds.length);
          });
      });
    }

    function syncVisibility() {
      const active = document.visibilityState === "visible" && navigator.onLine;
      controller.setActive(active);
      if (active) {
        void subscribe();
      } else {
        unsubscribe();
      }
    }

    const onFocus = () => controller.checkNow();
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", syncVisibility);
    window.addEventListener("offline", syncVisibility);
    document.addEventListener("visibilitychange", syncVisibility);
    syncVisibility();

    return () => {
      controller.dispose();
      controllerRef.current = null;
      unsubscribe();
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", syncVisibility);
      window.removeEventListener("offline", syncVisibility);
      document.removeEventListener("visibilitychange", syncVisibility);
    };
  }, [contestIdsKey, intervalMs, router, startTransition]);

  return null;
}
