import "server-only";

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createAppSession, getAppSessionCookieName, getAppSessionMaxAgeSeconds } from "@/lib/auth/app-session";
import { createRequiredServiceClient } from "@/lib/supabase/service";
import { sha256 } from "@/lib/security/token";

export function createEmailAuthClient() {
  // Never write a second Supabase session into the browser. Both QQ methods use
  // app_sessions and the canonical profile id returned by resolveQQProfile.
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function authJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function allowQQEmailAttempt(request: Request, qq: string, action: "send" | "verify") {
  const client = createRequiredServiceClient();
  const address = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const identity = sha256(qq);
  const ip = sha256(address);
  const limits: [string, number, number][] = action === "send"
    ? [[`send:minute:${identity}`, 1, 60], [`send:hour:${identity}`, 10, 3600], [`send:ip:${ip}`, 30, 3600], ["send:global", 500, 3600]]
    : [[`verify:qq:${identity}`, 10, 600], [`verify:ip:${ip}`, 60, 600]];
  for (const [key, limit, seconds] of limits) {
    const { data, error } = await client.rpc("take_qq_email_rate_limit", { p_key: key, p_limit: limit, p_seconds: seconds });
    if (error) throw new Error("QQ_EMAIL_LIMIT_UNAVAILABLE");
    if (!data) return false;
  }
  return true;
}

export async function attachQQSession(response: NextResponse, profileId: string) {
  const { sessionToken, expiresAt } = await createAppSession(profileId);
  response.cookies.set(getAppSessionCookieName(), sessionToken, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax",
    path: "/", maxAge: getAppSessionMaxAgeSeconds(), expires: expiresAt,
  });
  return response;
}
