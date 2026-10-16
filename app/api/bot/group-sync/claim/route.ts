import { NextResponse } from "next/server";
import { isAuthorizedBot } from "@/lib/security/bot-auth";
import { createRequiredServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!isAuthorizedBot(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await createRequiredServiceClient().rpc("claim_qq_group_sync_job", {});
  if (error) return NextResponse.json({ error: "读取同步任务失败。" }, { status: 500 });
  const job = data?.[0];
  return NextResponse.json({ job: job ? { id: job.id, qqGroupId: job.qq_group_id, leaseId: job.lease_id } : null },
    { headers: { "Cache-Control": "no-store" } });
}
