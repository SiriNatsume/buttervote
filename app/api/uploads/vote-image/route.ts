import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { createRequiredServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

const uuidPattern =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const allowedOutputImageTypes = new Set(["image/webp", "image/jpeg"]);

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function canUploadPath(storagePath: string, profileId: string, isAdmin: boolean) {
  if (storagePath === "homepage/hero.webp") {
    return isAdmin;
  }

  if (
    new RegExp(`^(contests|groups)/${uuidPattern}/cover\\.webp$`).test(
      storagePath,
    ) ||
    new RegExp(`^candidates/${uuidPattern}/image\\.webp$`).test(storagePath)
  ) {
    return isAdmin;
  }

  const nominationMatch = storagePath.match(
    new RegExp(`^nominations/(${uuidPattern})/image\\.webp$`),
  );

  if (!nominationMatch) {
    return false;
  }

  const supabase = createRequiredServiceClient();
  const { data: nomination } = await supabase
    .from("nominations")
    .select("id,submitter_id,status")
    .eq("id", nominationMatch[1])
    .maybeSingle();

  if (!nomination) {
    return false;
  }

  if (isAdmin) {
    return true;
  }

  return (
    nomination.submitter_id === profileId &&
    ["draft", "pending", "rejected"].includes(nomination.status)
  );
}

async function hasAllowedImageSignature(file: File) {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isWebp =
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50;

  return (
    (file.type === "image/jpeg" && isJpeg) ||
    (file.type === "image/webp" && isWebp)
  );
}

export async function POST(request: Request) {
  const profile = await getCurrentProfile();

  if (!profile) {
    return jsonError("请先登录后再上传图片。", 401);
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const storagePath = String(formData.get("storagePath") ?? "");
  const bucket = String(formData.get("bucket") ?? "vote-images");

  if (bucket !== "vote-images") {
    return jsonError("存储桶无效。", 400);
  }

  if (!(file instanceof File)) {
    return jsonError("图片文件无效。", 400);
  }

  if (!allowedOutputImageTypes.has(file.type) || file.size > 2 * 1024 * 1024) {
    return jsonError("仅支持 2MB 以内的 WebP 或 JPG 图片。", 400);
  }

  if (!(await hasAllowedImageSignature(file))) {
    return jsonError("图片内容与格式不匹配，请重新裁剪上传。", 400);
  }

  const allowed = await canUploadPath(
    storagePath,
    profile.id,
    profile.role === "admin",
  );

  if (!allowed) {
    return jsonError("你不能上传到这个位置。", 403);
  }

  const supabase = createRequiredServiceClient();
  const { error } = await supabase.storage.from(bucket).upload(storagePath, file, {
    cacheControl: "3600",
    contentType: file.type,
    upsert: true,
  });

  if (error) {
    return jsonError(error.message, 500);
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(storagePath);
  return NextResponse.json({ publicUrl: `${data.publicUrl}?v=${Date.now()}` });
}
