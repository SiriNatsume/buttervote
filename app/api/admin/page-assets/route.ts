import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getActionAdmin } from "@/lib/auth";
import {
  PAGE_ASSET_BUCKET,
  PAGE_ASSET_DEFAULT_VISIBILITY,
  PAGE_ASSET_FILE_MAX_SIZE,
  pageAssetMarkdown,
  pageAssetStoragePath,
  pageAssetUrl,
} from "@/lib/page-assets";
import { validatePageAssetFile } from "@/lib/security/page-asset-file";
import { hasSameOrigin } from "@/lib/security/request-origin";
import { createRequiredServiceClient } from "@/lib/supabase/service";
import type { PageVisibility } from "@/lib/types";

export const runtime = "nodejs";

const MAX_MULTIPART_OVERHEAD = 1024 * 1024;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  // SECURITY CRITICAL: this route is cookie authenticated and must reject CSRF.
  if (!hasSameOrigin(request)) return jsonError("请求来源无效。", 403);

  const admin = await getActionAdmin();
  if (!admin.ok) return jsonError(admin.error, 403);

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (
    Number.isFinite(contentLength) &&
    contentLength > PAGE_ASSET_FILE_MAX_SIZE + MAX_MULTIPART_OVERHEAD
  ) {
    return jsonError("上传请求超过 50 MB 限制。", 413);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError("上传表单无效或文件过大。", 400);
  }

  const file = formData.get("file");
  const requestedVisibility = String(
    formData.get("visibility") ?? PAGE_ASSET_DEFAULT_VISIBILITY,
  );
  if (!["admin_only", "public"].includes(requestedVisibility)) {
    return jsonError("附件可见性无效。", 400);
  }
  const visibility = requestedVisibility as PageVisibility;
  if (!(file instanceof File)) return jsonError("请选择文件。", 400);

  const validation = await validatePageAssetFile(file);
  if ("error" in validation) return jsonError(validation.error, 400);

  const assetId = crypto.randomUUID();
  const storagePath = pageAssetStoragePath(
    assetId,
    validation.rule.extension,
  );
  const supabase = createRequiredServiceClient();
  const { error: uploadError } = await supabase.storage
    .from(PAGE_ASSET_BUCKET)
    .upload(storagePath, file, {
      cacheControl: "3600",
      contentType: validation.rule.mimeType,
      upsert: false,
    });

  if (uploadError) {
    console.error(`[page-assets] upload failed: ${uploadError.message}`);
    return jsonError("文件上传失败，请稍后重试。", 500);
  }

  const { data: asset, error: insertError } = await supabase
    .from("page_assets")
    .insert({
      id: assetId,
      original_filename: validation.originalFilename,
      storage_path: storagePath,
      extension: validation.rule.extension,
      mime_type: validation.rule.mimeType,
      byte_size: file.size,
      asset_type: validation.rule.assetType,
      visibility,
      uploaded_by: admin.profile.id,
    })
    .select(
      "id,original_filename,extension,mime_type,byte_size,asset_type,visibility,created_at",
    )
    .single();

  if (insertError || !asset) {
    console.error(
      `[page-assets] metadata insert failed: ${insertError?.message ?? "no row returned"}`,
    );
    const { error: cleanupError } = await supabase.storage
      .from(PAGE_ASSET_BUCKET)
      .remove([storagePath]);
    if (cleanupError) {
      console.error(`[page-assets] failed upload cleanup: ${cleanupError.message}`);
    }
    return jsonError("附件 Metadata 保存失败，上传文件已回滚。", 500);
  }

  revalidatePath("/admin/assets");
  return NextResponse.json({
    asset,
    url: pageAssetUrl(asset.id),
    markdown: pageAssetMarkdown({
      id: asset.id,
      filename: asset.original_filename,
      assetType: asset.asset_type,
    }),
  });
}
