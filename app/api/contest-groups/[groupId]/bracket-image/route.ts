import { NextRequest, NextResponse } from "next/server";
import { exportBracketImage } from "@/lib/bracket-image/export";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BRACKET_IMAGE_CACHE_CONTROL = "private, no-store, max-age=0";

type RouteContext = {
  params: Promise<{
    groupId: string;
  }>;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": BRACKET_IMAGE_CACHE_CONTROL } });
}

function safeFilenamePart(value: string) {
  return (
    value
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "bracket"
  );
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { groupId } = await context.params;
  const tournamentId = request.nextUrl.searchParams.get("tournamentId");
  const requestedVersion = request.nextUrl.searchParams.get("v");
  const supabase = await createClient();

  try {
    if (!z.string().uuid().safeParse(groupId).success || (tournamentId && !z.string().uuid().safeParse(tournamentId).success)) {
      return jsonError("无效的对阵图参数。", 400);
    }
    if (!requestedVersion) return jsonError("对阵图状态已更新，请重试。", 409);
    const result = await exportBracketImage({ caller: supabase, groupId, tournamentId, requestedVersion });
    if (result.kind === "not-found") return jsonError("没有可导出的对阵图。", 404);
    if (result.kind === "changed") return NextResponse.json(
      { error: "对阵图状态已更新，请刷新页面后重试。" },
      { status: 409, headers: { "Cache-Control": BRACKET_IMAGE_CACHE_CONTROL } },
    );
    const png = result.png;
    const filename = `buttervote-${safeFilenamePart(result.groupName)}-bracket.png`;

    return new NextResponse(new Uint8Array(png), {
      headers: {
        "Cache-Control": BRACKET_IMAGE_CACHE_CONTROL,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
          filename,
        )}`,
        "Content-Type": "image/png",
        "Server-Timing": `export;dur=${result.elapsedMs};desc="${result.cache}"`,
      },
    });
  } catch (error) {
    console.error("Failed to generate bracket image.", error);
    return jsonError("生成对阵图图片失败。", 500);
  }
}
