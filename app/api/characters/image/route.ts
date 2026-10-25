import { NextResponse } from "next/server";
import { z } from "zod";
import { getActionUser } from "@/lib/auth";
import { CHARACTER_SOURCES } from "@/lib/character-search/types";
import { fetchCharacterImage, isCharacterImageUrl } from "@/lib/character-search/image";

const schema = z.object({ source: z.enum(CHARACTER_SOURCES), url: z.string().max(1500) });

export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  const auth = await getActionUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401, headers });
  const params = new URL(request.url).searchParams;
  const parsed = schema.safeParse({ source: params.get("source"), url: params.get("url") });
  if (!parsed.success || !isCharacterImageUrl(parsed.data.source, parsed.data.url)) {
    return NextResponse.json({ error: "角色图片地址无效。" }, { status: 400, headers });
  }

  try {
    const image = await fetchCharacterImage(parsed.data.source, parsed.data.url);
    return new Response(image.bytes, { headers: {
      "Content-Type": image.contentType,
      "Content-Length": String(image.bytes.byteLength),
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    return NextResponse.json({ error: "角色图片加载失败，请换一张图片或稍后重试。" }, { status: 502, headers });
  }
}
