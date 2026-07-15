import { NextRequest, NextResponse } from "next/server";
import { getBracketImageDataForGroup } from "@/lib/bracket-image/data";
import { renderBracketImageSvg } from "@/lib/bracket-image/svg";
import { svgToPng } from "@/lib/bracket-image/png";
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
  return NextResponse.json({ error: message }, { status });
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
    const bracketData = await getBracketImageDataForGroup({
      supabase,
      groupId,
      tournamentId,
    });

    if (!bracketData || bracketData.matches.length === 0) {
      return jsonError("没有可导出的对阵图。", 404);
    }

    if (
      !requestedVersion ||
      requestedVersion !== bracketData.visibilityVersion
    ) {
      return NextResponse.json(
        { error: "对阵图状态已更新，请重试。" },
        {
          status: 409,
          headers: { "Cache-Control": BRACKET_IMAGE_CACHE_CONTROL },
        },
      );
    }

    const svg = await renderBracketImageSvg(bracketData);
    const png = await svgToPng(svg);
    const filename = `buttervote-${safeFilenamePart(
      bracketData.groupName,
    )}-bracket.png`;

    return new NextResponse(new Uint8Array(png), {
      headers: {
        "Cache-Control": BRACKET_IMAGE_CACHE_CONTROL,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
          filename,
        )}`,
        "Content-Type": "image/png",
      },
    });
  } catch (error) {
    console.error("Failed to generate bracket image.", error);
    return jsonError("生成对阵图图片失败。", 500);
  }
}
