import "server-only";
import { createRequiredServiceClient } from "@/lib/supabase/service";
import { fetchPageRows } from "@/lib/supabase-pagination";

export async function loadQQGroupSyncSnapshot(userGroupId: string, requestedPage: number) {
  const service = createRequiredServiceClient();
  const [config, job, roster] = await Promise.all([
    service.from("qq_group_sync_configs").select("user_group_id,qq_group_id,last_synced_at,member_count").eq("user_group_id", userGroupId).maybeSingle(),
    service.from("qq_group_sync_jobs").select("id,user_group_id,qq_group_id,requested_by,status,requested_at,started_at,finished_at,lease_id,error,member_count")
      .eq("user_group_id", userGroupId).order("requested_at", { ascending: false }).order("id").limit(1).maybeSingle(),
    fetchPageRows(() => service.from("qq_group_roster").select("user_group_id,qq_user_id,nickname,card", { count: "exact" })
      .eq("user_group_id", userGroupId).order("qq_user_id"), requestedPage),
  ]);
  if (config.error || job.error || roster.error) throw new Error("无法读取 QQ 群同步状态。");
  return { config: config.data ? { ...config.data, member_count: roster.totalCount } : null,
    job: job.data, members: roster.data, page: roster.page, totalPages: roster.totalPages };
}
