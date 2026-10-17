import "server-only";

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createAppSession, getAppSessionCookieName, getAppSessionMaxAgeSeconds } from "@/lib/auth/app-session";
import { createRequiredServiceClient } from "@/lib/supabase/service";
import { sha256 } from "@/lib/security/token";
import { qqEmailAddress } from "@/lib/validation/qq-auth";

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

export async function allowQQEmailAttempt(request: Request, qq: string, action: "lookup" | "send" | "verify" | "password") {
  const client = createRequiredServiceClient();
  const address = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const identity = sha256(qq);
  const ip = sha256(address);
  const limits: [string, number, number][] = action === "send"
    ? [[`send:minute:${identity}`, 1, 60], [`send:hour:${identity}`, 10, 3600], [`send:ip:${ip}`, 30, 3600], ["send:global", 500, 3600]]
    : action === "lookup"
      ? [[`lookup:qq:${identity}`, 20, 600], [`lookup:ip:${ip}`, 60, 600]]
      : [[`${action}:qq:${identity}`, 10, 600], [`${action}:ip:${ip}`, 60, 600]];
  for (const [key, limit, seconds] of limits) {
    const { data, error } = await client.rpc("take_qq_email_rate_limit", { p_key: key, p_limit: limit, p_seconds: seconds });
    if (error) throw new Error("QQ_EMAIL_LIMIT_UNAVAILABLE");
    if (!data) return false;
  }
  return true;
}

export async function attachQQSession(response: NextResponse, profileId: string, remember = false) {
  const maxAge = remember ? getAppSessionMaxAgeSeconds() : 12 * 60 * 60;
  const { sessionToken, expiresAt } = await createAppSession(profileId, maxAge);
  response.cookies.set(getAppSessionCookieName(), sessionToken, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax",
    path: "/", ...(remember ? { maxAge, expires: expiresAt } : {}),
  });
  return response;
}

export async function getQQEmailAccountState(qq: string) {
  const { data, error } = await createRequiredServiceClient().rpc("get_qq_email_account_state", { p_qq_user_id: qq });
  if (error || !data?.[0]) throw new Error("QQ_ACCOUNT_LOOKUP_UNAVAILABLE");
  return data[0];
}

export async function markQQPasswordSet(user: { id: string; app_metadata: Record<string, unknown> }) {
  const { error } = await createRequiredServiceClient().auth.admin.updateUserById(user.id, {
    app_metadata: { ...user.app_metadata, qq_password_set: true },
  });
  if (error) throw new Error("QQ_PASSWORD_STATE_UNAVAILABLE");
}

export function qqAuthError(error: unknown) {
  if (error instanceof Error && error.message.includes("QQ_IDENTITY_CONFLICT")) {
    return authJson({ error: "检测到历史账号冲突，请使用原 QQ Bot 登录并联系管理员处理；投票记录已保留。" }, 409);
  }
  return authJson({ error: "登录服务暂时不可用，请稍后重试。" }, 503);
}

export async function sendQQEmailCode(request: Request, qq: string, purpose: "register" | "reset") {
  const state = await getQQEmailAccountState(qq);
  if (purpose === "register" && state.has_password && state.email_confirmed) {
    return authJson({ error: "此 QQ 号已注册，请输入密码登录。", step: "password" }, 409);
  }
  if (purpose === "reset" && !state.email_confirmed) {
    return authJson({ error: "此 QQ 号尚未完成邮箱注册，请返回登录页验证邮箱并设置密码。" }, 400);
  }
  const step = purpose === "reset" ? "reset" : state.registered ? "setup" : "register";
  if (!await allowQQEmailAttempt(request, qq, "send")) {
    return authJson({ error: "发送过于频繁，请稍后重试；已收到的验证码仍可使用。", step, retryAfter: 60 }, 429);
  }
  const email = qqEmailAddress(qq);
  const auth = createEmailAuthClient();
  if (purpose === "register" && !state.email_confirmed) {
    // Provision only an unconfirmed Auth identity. The voter profile is claimed
    // after mailbox verification and successful password creation.
    const provision = await createRequiredServiceClient().auth.admin.createUser({ email, email_confirm: false, app_metadata: { qq_password_set: false } });
    if (provision.error && !["email_exists", "user_already_exists"].includes(provision.error.code ?? "")) {
      return authJson({ error: "验证码暂时无法发送，请稍后重试。", step }, 503);
    }
  }
  const { error } = purpose === "reset"
    ? await auth.auth.resetPasswordForEmail(email)
    : state.email_confirmed
      ? await auth.auth.signInWithOtp({ email, options: { shouldCreateUser: false } })
      : await auth.auth.resend({ type: "signup", email });
  if (error) return authJson({ error: "验证码暂时无法发送，请稍后重试。", step }, 503);
  return authJson({ ok: true, step, message: `验证码已发送到 ${email}。`, retryAfter: 60 });
}
