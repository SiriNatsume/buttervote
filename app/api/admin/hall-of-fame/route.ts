import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getActionAdmin } from "@/lib/auth";
import {
  HALL_OF_FAME_BUCKET,
  HALL_OF_FAME_IMAGE_TYPES,
  HALL_OF_FAME_MAX_FILE_SIZE,
} from "@/lib/hall-of-fame";
import { createRequiredServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

const allowedTypes = new Set<string>(HALL_OF_FAME_IMAGE_TYPES);
const extensionByType: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
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
  const entryId = String(formData.get("entryId") ?? "").trim() || null;
  const contestId = String(formData.get("contestId") ?? "").trim() || null;
  const eventTitle = String(formData.get("eventTitle") ?? "").trim();
  const winnerName = String(formData.get("winnerName") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const fileValue = formData.get("poster");
  const file = fileValue instanceof File && fileValue.size > 0 ? fileValue : null;

  if (!eventTitle || eventTitle.length > 120) {
    return jsonError("赛事标题不能为空，且不能超过 120 个字符。", 400);
  }
  if (!winnerName || winnerName.length > 120) {
    return jsonError("胜者名不能为空，且不能超过 120 个字符。", 400);
  }
  if (description.length > 200) {
    return jsonError("Description 不能超过 200 个字符。", 400);
  }
  if (file && (!allowedTypes.has(file.type) || file.size > HALL_OF_FAME_MAX_FILE_SIZE)) {
    return jsonError("仅支持 20MB 以内的 JPEG、PNG 或 WebP 图片。", 400);
  }
  if (file && !(await hasValidSignature(file))) {
    return jsonError("图片内容与文件格式不匹配。", 400);
  }

  const supabase = createRequiredServiceClient();
  if (contestId) {
    const { data: contest } = await supabase
      .from("contests")
      .select("id")
      .eq("id", contestId)
      .maybeSingle();
    if (!contest) return jsonError("关联赛事不存在。", 400);
  }

  const { data: existing, error: lookupError } = entryId
    ? await supabase
        .from("hall_of_fame_entries")
        .select("id,poster_path,poster_mime_type,poster_size")
        .eq("id", entryId)
        .maybeSingle()
    : { data: null, error: null };

  if (lookupError) return jsonError(lookupError.message, 500);
  if (entryId && !existing) return jsonError("冠军英灵殿条目不存在。", 404);
  if (!existing && !file) return jsonError("请选择海报图片。", 400);

  let newPath: string | null = null;
  if (file) {
    const ownerId = existing?.id ?? crypto.randomUUID();
    newPath = `entries/${ownerId}/${crypto.randomUUID()}.${extensionByType[file.type]}`;
    const { error: uploadError } = await supabase.storage
      .from(HALL_OF_FAME_BUCKET)
      .upload(newPath, file, {
        cacheControl: "31536000",
        contentType: file.type,
        upsert: false,
      });
    if (uploadError) return jsonError(uploadError.message, 500);
  }

  const posterPath = newPath ?? existing?.poster_path;
  const posterMimeType = file?.type ?? existing?.poster_mime_type;
  const posterSize = file?.size ?? existing?.poster_size;
  if (!posterPath || !posterMimeType || !posterSize) {
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
      })
      .eq("id", existing.id);
    databaseError = error;
  } else {
    const { data: lastEntry } = await supabase
      .from("hall_of_fame_entries")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { error } = await supabase.from("hall_of_fame_entries").insert({
      contest_id: contestId,
      event_title: eventTitle,
      winner_name: winnerName,
      description,
      poster_path: posterPath,
      poster_mime_type: posterMimeType as "image/jpeg" | "image/png" | "image/webp",
      poster_size: posterSize,
      sort_order: (lastEntry?.sort_order ?? -1) + 1,
      created_by: admin.profile.id,
    });
    databaseError = error;
  }

  if (databaseError) {
    if (newPath) await supabase.storage.from(HALL_OF_FAME_BUCKET).remove([newPath]);
    return jsonError(databaseError.message, 500);
  }

  let cleanupWarning: string | null = null;
  if (newPath && existing?.poster_path) {
    const { error: cleanupError } = await supabase.storage
      .from(HALL_OF_FAME_BUCKET)
      .remove([existing.poster_path]);
    if (cleanupError) {
      cleanupWarning = `条目已保存，但旧海报文件清理失败：${cleanupError.message}`;
    }
  }

  revalidatePath("/hall-of-fame");
  revalidatePath("/admin/hall-of-fame");
  return NextResponse.json({ ok: true, warning: cleanupWarning });
}
