import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getActionAdmin } from "@/lib/auth";
import { PAGE_ASSET_BUCKET } from "@/lib/page-assets";
import { hasSameOrigin } from "@/lib/security/request-origin";
import { createRequiredServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // SECURITY CRITICAL: deletion uses service role and must be both same-origin
  // and explicitly authorized as an administrator operation.
  if (!hasSameOrigin(request)) return jsonError("请求来源无效。", 403);
  const admin = await getActionAdmin();
  if (!admin.ok) return jsonError(admin.error, 403);

  const body = (await request.json().catch(() => null)) as {
    confirm?: boolean;
  } | null;
  if (body?.confirm !== true) return jsonError("请明确确认删除附件。", 400);

  const { id } = await params;
  const supabase = createRequiredServiceClient();
  const { data: asset, error: lookupError } = await supabase
    .from("page_assets")
    .select("id,storage_path")
    .eq("id", id)
    .maybeSingle();

  if (lookupError) {
    console.error(`[page-assets] delete lookup failed: ${lookupError.message}`);
    return jsonError("读取附件失败。", 500);
  }
  if (!asset) return jsonError("附件不存在。", 404);

  const { error: storageError } = await supabase.storage
    .from(PAGE_ASSET_BUCKET)
    .remove([asset.storage_path]);
  if (storageError) {
    console.error(`[page-assets] storage delete failed: ${storageError.message}`);
    return jsonError("Storage 文件删除失败，Metadata 未删除。", 500);
  }

  const { error: databaseError } = await supabase
    .from("page_assets")
    .delete()
    .eq("id", asset.id);
  if (databaseError) {
    console.error(`[page-assets] metadata delete failed: ${databaseError.message}`);
    return jsonError(
      "文件已删除，但 Metadata 清理失败。请重试删除或人工检查。",
      500,
    );
  }

  revalidatePath("/admin/assets");
  return NextResponse.json({ ok: true });
}
