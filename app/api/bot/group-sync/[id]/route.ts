import { NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorizedBot } from "@/lib/security/bot-auth";
import { rosterResultSchema } from "@/lib/validation/qq-auth";
import { createRequiredServiceClient } from "@/lib/supabase/service";
import { getUserGroupMembershipDays } from "@/lib/permissions/user-groups";

export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAuthorizedBot(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "无效任务。" }, { status: 400 });
  const text = await request.text();
  if (text.length > 4_000_000) return NextResponse.json({ error: "名单过大。" }, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(text); } catch { return NextResponse.json({ error: "无效 JSON。" }, { status: 400 }); }
  const parsed = rosterResultSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "名单或任务凭据无效。" }, { status: 400 });
  const errors = {
    bot_unavailable: "Bot 无法读取群成员，请检查 Bot 连接后重新同步。",
    incomplete_roster: "群成员名单不完整，已保留上次同步结果。",
    group_not_allowed: "Bot 端未允许同步这个 QQ 群。",
  };
  const { data, error } = await createRequiredServiceClient().rpc("finish_qq_group_sync_job", {
    p_job_id: id, p_lease_id: parsed.data.leaseId,
    p_members: parsed.data.members ?? null,
    p_error: parsed.data.error ? errors[parsed.data.error] : null,
    p_days: Math.min(90, Math.max(1, Math.floor(getUserGroupMembershipDays()))),
  });
  if (error) return NextResponse.json({ error: "同步失败，原名单未更改。" }, { status: 400 });
  if (!data) return NextResponse.json({ error: "同步任务已过期或完成。" }, { status: 409 });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
