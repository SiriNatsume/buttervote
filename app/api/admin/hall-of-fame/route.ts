import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getActionAdmin } from "@/lib/auth";
import {
  HALL_OF_FAME_BUCKET,
  HALL_OF_FAME_IMAGE_TYPES,
  HALL_OF_FAME_MAX_FILE_SIZE,
  HALL_OF_FAME_THUMBNAIL_MAX_FILE_SIZE,
  HALL_OF_FAME_THUMBNAIL_TYPES,
} from "@/lib/hall-of-fame";
import { createRequiredServiceClient } from "@/lib/supabase/service";
import {
  getValidationMessage,
  hallOfFameEntryInputSchema,
} from "@/lib/validation/hall-of-fame";

export const runtime = "nodejs";

const allowedTypes = new Set<string>(HALL_OF_FAME_IMAGE_TYPES);
const allowedThumbnailTypes = new Set<string>(HALL_OF_FAME_THUMBNAIL_TYPES);
const extensionByType: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function getFormText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function logServerError(scope: string, error: { message: string }) {
  console.error(`[hall-of-fame] ${scope}: ${error.message}`);
}

async function hasValidSignature(file: File) {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png =
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;
  const webp =
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50;

  return (
    (file.type === "image/jpeg" && jpeg) ||
    (file.type === "image/png" && png) ||
    (file.type === "image/webp" && webp)
  );
}

export async function POST(request: Request) {
  const admin = await getActionAdmin();
  if (!admin.ok) return jsonError(admin.error, 403);

  const formData = await request.formData();
  const parsed = hallOfFameEntryInputSchema.safeParse({
    entryId: getFormText(formData, "entryId"),
    contestId: getFormText(formData, "contestId"),
    eventTitle: getFormText(formData, "eventTitle"),
    winnerName: getFormText(formData, "winnerName"),
    description: getFormText(formData, "description"),
  });
  if (!parsed.success) {
    return jsonError(getValidationMessage(parsed.error), 400);
  }

  const { entryId, contestId, eventTitle, winnerName, description } = parsed.data;
  const fileValue = formData.get("poster");
  const file = fileValue instanceof File && fileValue.size > 0 ? fileValue : null;
  const thumbnailValue = formData.get("thumbnail");
  const thumbnail =
    thumbnailValue instanceof File && thumbnailValue.size > 0
      ? thumbnailValue
      : null;

  if (Boolean(file) !== Boolean(thumbnail)) {
    return jsonError("替换海报时必须同时生成缩略图。", 400);
  }
  if (file && (!allowedTypes.has(file.type) || file.size > HALL_OF_FAME_MAX_FILE_SIZE)) {
    return jsonError("仅支持 20MB 以内的 JPEG、PNG 或 WebP 图片。", 400);
  }
  if (file && !(await hasValidSignature(file))) {
    return jsonError("图片内容与文件格式不匹配。", 400);
  }
  if (
    thumbnail &&
    (!allowedThumbnailTypes.has(thumbnail.type) ||
      thumbnail.size > HALL_OF_FAME_THUMBNAIL_MAX_FILE_SIZE)
  ) {
    return jsonError("缩略图必须是 320KB 以内的 JPEG 或 WebP 图片。", 400);
  }
  if (thumbnail && !(await hasValidSignature(thumbnail))) {
    return jsonError("缩略图内容与文件格式不匹配。", 400);
  }

  const supabase = createRequiredServiceClient();
  if (contestId) {
    const { data: contest, error: contestError } = await supabase
      .from("contests")
      .select("id")
      .eq("id", contestId)
      .maybeSingle();
    if (contestError) {
      logServerError("contest lookup failed", contestError);
      return jsonError("验证关联活动失败，请稍后重试。", 500);
    }
    if (!contest) return jsonError("关联赛事不存在。", 400);
  }

  const { data: existing, error: lookupError } = entryId
    ? await supabase
        .from("hall_of_fame_entries")
        .select(
          "id,poster_path,poster_mime_type,poster_size,thumbnail_path,thumbnail_mime_type,thumbnail_size",
        )
        .eq("id", entryId)
        .maybeSingle()
    : { data: null, error: null };

  if (lookupError) {
    logServerError("entry lookup failed", lookupError);
    return jsonError("读取名人堂条目失败，请稍后重试。", 500);
  }
  if (entryId && !existing) return jsonError("冠军英灵殿条目不存在。", 404);
  if (!existing && !file) return jsonError("请选择海报图片。", 400);

  const targetEntryId = existing?.id ?? crypto.randomUUID();
  const uploadedPaths: string[] = [];
  async function cleanupUploadedPaths() {
    if (uploadedPaths.length === 0) return;
    const { error } = await supabase.storage
      .from(HALL_OF_FAME_BUCKET)
      .remove(uploadedPaths);
    if (error) logServerError("new asset cleanup failed", error);
  }

  let newPosterPath: string | null = null;
  let newThumbnailPath: string | null = null;
  if (file && thumbnail) {
    const assetId = crypto.randomUUID();
    newPosterPath = `entries/${targetEntryId}/${assetId}.${extensionByType[file.type]}`;
    newThumbnailPath = `entries/${targetEntryId}/${assetId}-thumbnail.${extensionByType[thumbnail.type]}`;

    const { error: posterUploadError } = await supabase.storage
      .from(HALL_OF_FAME_BUCKET)
      .upload(newPosterPath, file, {
        cacheControl: "31536000",
        contentType: file.type,
        upsert: false,
      });
    if (posterUploadError) {
      logServerError("poster upload failed", posterUploadError);
      return jsonError("原图上传失败，请稍后重试。", 500);
    }
    uploadedPaths.push(newPosterPath);

    const { error: thumbnailUploadError } = await supabase.storage
      .from(HALL_OF_FAME_BUCKET)
      .upload(newThumbnailPath, thumbnail, {
        cacheControl: "31536000",
        contentType: thumbnail.type,
        upsert: false,
      });
    if (thumbnailUploadError) {
      logServerError("thumbnail upload failed", thumbnailUploadError);
      await cleanupUploadedPaths();
      return jsonError("缩略图上传失败，请稍后重试。", 500);
    }
    uploadedPaths.push(newThumbnailPath);
  }

  const posterPath = newPosterPath ?? existing?.poster_path;
  const posterMimeType = file?.type ?? existing?.poster_mime_type;
  const posterSize = file?.size ?? existing?.poster_size;
  const thumbnailPath = newThumbnailPath ?? existing?.thumbnail_path;
  const thumbnailMimeType = thumbnail?.type ?? existing?.thumbnail_mime_type;
  const thumbnailSize = thumbnail?.size ?? existing?.thumbnail_size;
  if (
    !posterPath ||
    !posterMimeType ||
    !posterSize ||
    !thumbnailPath ||
    !thumbnailMimeType ||
    !thumbnailSize
  ) {
    await cleanupUploadedPaths();
    return jsonError("海报数据不完整。", 400);
  }

  let databaseError: { message: string } | null = null;
  if (existing) {
    const { error } = await supabase
      .from("hall_of_fame_entries")
      .update({
        contest_id: contestId,
        event_title: eventTitle,
        winner_name: winnerName,
        description,
        poster_path: posterPath,
        poster_mime_type: posterMimeType as "image/jpeg" | "image/png" | "image/webp",
        poster_size: posterSize,
        thumbnail_path: thumbnailPath,
        thumbnail_mime_type: thumbnailMimeType as "image/jpeg" | "image/webp",
        thumbnail_size: thumbnailSize,
      })
      .eq("id", existing.id);
    databaseError = error;
  } else {
    const { data: lastEntry, error: orderError } = await supabase
      .from("hall_of_fame_entries")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (orderError) {
      logServerError("sort order lookup failed", orderError);
      await cleanupUploadedPaths();
      return jsonError("读取展示顺序失败，请稍后重试。", 500);
    }
    const { error } = await supabase.from("hall_of_fame_entries").insert({
      id: targetEntryId,
      contest_id: contestId,
      event_title: eventTitle,
      winner_name: winnerName,
      description,
      poster_path: posterPath,
      poster_mime_type: posterMimeType as "image/jpeg" | "image/png" | "image/webp",
      poster_size: posterSize,
      thumbnail_path: thumbnailPath,
      thumbnail_mime_type: thumbnailMimeType as "image/jpeg" | "image/webp",
      thumbnail_size: thumbnailSize,
      sort_order: (lastEntry?.sort_order ?? -1) + 1,
      created_by: admin.profile.id,
    });
    databaseError = error;
  }

  if (databaseError) {
    logServerError("database write failed", databaseError);
    await cleanupUploadedPaths();
    return jsonError("保存名人堂条目失败，请稍后重试。", 500);
  }

  let cleanupWarning: string | null = null;
  if (newPosterPath && existing) {
    const { error: cleanupError } = await supabase.storage
      .from(HALL_OF_FAME_BUCKET)
      .remove([existing.poster_path, existing.thumbnail_path]);
    if (cleanupError) {
      logServerError("old asset cleanup failed", cleanupError);
      cleanupWarning = "条目已保存，但旧图片文件清理失败，请稍后检查 Storage。";
    }
  }

  revalidatePath("/hall-of-fame");
  revalidatePath("/admin/hall-of-fame");
  return NextResponse.json({ ok: true, warning: cleanupWarning });
}
