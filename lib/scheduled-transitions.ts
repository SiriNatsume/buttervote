import "server-only";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import type { ScheduledTransitionTarget } from "@/lib/types";

type DueTransition = {
  id: string;
  contest_id: string;
  target_status: ScheduledTransitionTarget;
  run_at: string;
};

type AppliedTransition = {
  transition_id: string;
  contest_id: string;
  target_status: string;
  run_at: string;
  group_id: string | null;
};

type ApplyScheduledTransitionsOptions = {
  revalidate?: boolean;
};

function contestUpdateForTransition(transition: DueTransition) {
  return {
    status: transition.target_status,
    ...(transition.target_status === "voting"
      ? { voting_starts_at: transition.run_at }
      : {}),
    ...(transition.target_status === "closed"
      ? { voting_ends_at: transition.run_at }
      : {}),
  };
}

function revalidateContestViews(contestId: string, groupId?: string | null) {
  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath(`/admin/contests/${contestId}/edit`);
  revalidatePath(`/admin/contests/${contestId}/candidates`);
  revalidatePath(`/contests/${contestId}`);
  revalidatePath(`/contests/${contestId}/vote`);
  revalidatePath(`/contests/${contestId}/results`);

  if (groupId) {
    revalidatePath(`/groups/${groupId}`);
    revalidatePath(`/groups/${groupId}/vote`);
    revalidatePath(`/admin/groups/${groupId}`);
    revalidatePath(`/admin/groups/${groupId}/edit`);
  }
}

export function revalidateAppliedTransitions(transitions: AppliedTransition[]) {
  for (const transition of transitions) {
    revalidateContestViews(transition.contest_id, transition.group_id);
  }
}

async function applyTransitionsWithServiceClient(transitions: DueTransition[]) {
  const supabase = createServiceClient();

  if (!supabase || transitions.length === 0) {
    return [];
  }

  const applied: AppliedTransition[] = [];

  for (const transition of transitions) {
    const { data: contest, error: contestError } = await supabase
      .from("contests")
      .update(contestUpdateForTransition(transition))
      .eq("id", transition.contest_id)
      .is("archived_at", null)
      .select("group_id")
      .maybeSingle();

    if (contestError) {
      console.warn("定时状态更新活动失败", transition.id, contestError.message);
      continue;
    }

    const { error: transitionError } = await supabase
      .from("contest_scheduled_transitions")
      .update({ executed_at: new Date().toISOString() })
      .eq("id", transition.id)
      .is("executed_at", null);

    if (!transitionError) {
      applied.push({
        transition_id: transition.id,
        contest_id: transition.contest_id,
        target_status: transition.target_status,
        run_at: transition.run_at,
        group_id: contest?.group_id ?? null,
      });
    } else {
      console.warn("定时状态标记执行失败", transition.id, transitionError.message);
    }
  }

  return applied;
}

async function applyWithServiceFallback(contestId?: string) {
  const supabase = createServiceClient();

  if (!supabase) {
    return [];
  }

  let query = supabase
    .from("contest_scheduled_transitions")
    .select("id,contest_id,target_status,run_at,contests!inner(archived_at)")
    .is("executed_at", null)
    .is("contests.archived_at", null)
    .lte("run_at", new Date().toISOString())
    .order("run_at", { ascending: true });

  if (contestId) {
    query = query.eq("contest_id", contestId);
  }

  const { data, error } = await query;
  if (error) {
    console.warn("定时状态 fallback 查询失败", error.message);
    return [];
  }

  return applyTransitionsWithServiceClient((data ?? []) as DueTransition[]);
}

async function applyWithRpc(contestId?: string) {
  const supabase = createServiceClient();
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase.rpc("apply_due_scheduled_transitions", {
    p_contest_id: contestId ?? null,
  });

  if (error) {
    console.warn("定时状态 RPC 执行失败，将尝试 service fallback", error.message);
    return null;
  }

  return (data ?? []) as AppliedTransition[];
}

export async function applyScheduledTransitionsCore(contestId?: string) {
  return (
    (await applyWithRpc(contestId)) ??
    (await applyWithServiceFallback(contestId))
  );
}

export async function applyScheduledTransitions(
  options: ApplyScheduledTransitionsOptions = {},
) {
  const applied = await applyScheduledTransitionsCore();

  if (options.revalidate === true) {
    revalidateAppliedTransitions(applied);
  }

  return applied.length;
}

export async function applyDueScheduledTransitionsForContest(
  contestId: string,
  options: ApplyScheduledTransitionsOptions = {},
) {
  const applied = await applyScheduledTransitionsCore(contestId);

  if (options.revalidate === true) {
    revalidateAppliedTransitions(applied);
  }

  return applied.length;
}
