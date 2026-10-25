import { NextResponse } from "next/server";
import { getActionUser } from "@/lib/auth";
import { characterSearchSchema, searchCharacters } from "@/lib/character-search/providers";

export async function GET(request: Request) {
  const auth = await getActionUser();
  const headers = { "Cache-Control": "private, no-store" };
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401, headers });

  const params = new URL(request.url).searchParams;
  const parsed = characterSearchSchema.safeParse({
    query: params.get("q") ?? "",
    source: params.get("source") ?? "all",
    page: params.get("page") ?? "1",
  });
  if (!parsed.success) return NextResponse.json({ error: "请输入 1–100 字的角色名，并选择有效的来源和页码。" }, { status: 400, headers });

  const result = await searchCharacters(parsed.data.query, parsed.data.source, parsed.data.page, {
    bangumiUserAgent: process.env.BANGUMI_USER_AGENT,
    bangumiAccessToken: process.env.BANGUMI_ACCESS_TOKEN,
    signal: request.signal,
    onProviderFailure: (failure) => console.warn("Character search upstream failure", failure),
  });
  return NextResponse.json(result, { headers });
}
