import { NextResponse } from "next/server";
import { z } from "zod";
import { getActionAdmin } from "@/lib/auth";
import { loadQQGroupSyncSnapshot } from "@/lib/qq-group-sync-snapshot";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const headers = { "Cache-Control": "private, no-store, max-age=0" };
  const admin = await getActionAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: 403, headers });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "用户组无效。" }, { status: 400, headers });
  const page = Number(new URL(request.url).searchParams.get("rosterPage") ?? 1);
  try {
    return NextResponse.json(await loadQQGroupSyncSnapshot(id, page), { headers });
  } catch {
    return NextResponse.json({ error: "无法读取匹配名单，请重试。" }, { status: 503, headers });
  }
}
