import { NextResponse } from "next/server";
import { z } from "zod";
import {
  generateRandomToken,
  getEnvNumber,
  safeReturnTo,
  sha256,
  timingSafeEqualString,
} from "@/lib/security/token";
import { createRequiredServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

const joinCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9_-]+$/);

const requestSchema = z.object({
  qqUserId: z.string().trim().min(1).max(128),
  qqNickname: z.string().trim().max(120).optional().nullable(),
  qqAvatarUrl: z.string().url().max(1000).optional().nullable(),
  returnTo: z.string().optional().nullable(),
  userGroupJoinCodes: z.array(joinCodeSchema).optional(),
});

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function getSiteOrigin(request: Request) {
  const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();

  if (configuredUrl) {
    try {
      return new URL(configuredUrl).origin;
    } catch {
      // Fall back to the incoming origin below.
    }
  }

  return new URL(request.url).origin;
}

export async function POST(request: Request) {
  const expectedSecret = process.env.BOT_API_SECRET;
  const authorization = request.headers.get("authorization");
  const bearerToken = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;

  if (!expectedSecret || !timingSafeEqualString(bearerToken, expectedSecret)) {
    return jsonError("Unauthorized", 401);
  }

  const body = requestSchema.safeParse(await request.json().catch(() => null));

  if (!body.success) {
    return jsonError("参数错误。", 400);
  }

  const supabase = createRequiredServiceClient();
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + getEnvNumber("QQ_LOGIN_TICKET_TTL_MINUTES", 5) * 60 * 1000,
  );
  const token = generateRandomToken();
  const returnTo = safeReturnTo(body.data.returnTo);
  const userGroupJoinCodes = [...new Set(body.data.userGroupJoinCodes ?? [])];

  const { error } = await supabase.from("qq_login_tickets").insert({
    token_hash: sha256(token),
    qq_user_id: body.data.qqUserId,
    qq_nickname: body.data.qqNickname || null,
    qq_avatar_url: body.data.qqAvatarUrl || null,
    return_to: returnTo,
    user_group_join_codes: userGroupJoinCodes,
    expires_at: expiresAt.toISOString(),
  });

  if (error) {
    return jsonError("生成登录链接失败。", 500);
  }

  const url = new URL("/auth/qq-ticket", getSiteOrigin(request));
  url.searchParams.set("token", token);

  return NextResponse.json({ url: url.toString() });
}
