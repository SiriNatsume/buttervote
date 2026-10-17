import { hasSameOrigin } from "@/lib/security/request-origin";
import { safeReturnTo } from "@/lib/security/token";
import { qqEmailAddress, qqEmailVerifySchema } from "@/lib/validation/qq-auth";
import { allowQQEmailAttempt, attachQQSession, authJson, createEmailAuthClient, getQQEmailAccountState, markQQPasswordSet, qqAuthError } from "@/lib/auth/qq-email";
import { revokeProfileAppSessions } from "@/lib/auth/app-session";
import { resolveQQProfile, syncQQProfileMemberships } from "@/lib/auth/qq-profile";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return authJson({ error: "请求来源无效。" }, 403);
  const parsed = qqEmailVerifySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return authJson({ error: parsed.error.issues[0]?.message ?? "请填写验证码和新密码。" }, 400);
  const auth = createEmailAuthClient();
  try {
    const { qq, code, password, purpose, remember, returnTo } = parsed.data;
    if (!await allowQQEmailAttempt(request, qq, "verify")) {
      return authJson({ error: "验证尝试过多，请稍后再试。" }, 429);
    }
    const state = await getQQEmailAccountState(qq);
    if (purpose === "register" && state.has_password && state.email_confirmed) {
      return authJson({ error: "此 QQ 号已设置密码，请使用密码登录或找回密码。", step: "password" }, 409);
    }
    if (purpose === "reset" && !state.email_confirmed) {
      return authJson({ error: "此 QQ 号尚未完成邮箱注册，请返回登录页。" }, 400);
    }
    const email = qqEmailAddress(qq);
    const { data, error } = await auth.auth.verifyOtp({ email, token: code, type: purpose === "reset" ? "recovery" : "email" });
    if (error || !data.user || data.user.email?.toLowerCase() !== email || !data.user.email_confirmed_at) {
      return authJson({ error: "验证码错误或已过期，请重新输入或获取。" }, 400);
    }
    // Set the password only through the freshly verified user session.
    const updated = await auth.auth.updateUser({ password });
    if (updated.error && updated.error.code !== "same_password") {
      return authJson({ error: "密码未能保存，请重新获取验证码后重试；密码至少 8 位。" }, 400);
    }
    await markQQPasswordSet(data.user);
    const profileId = await resolveQQProfile(qq, { verifiedAuthUserId: data.user.id });
    if (purpose === "reset") await revokeProfileAppSessions(profileId);
    await syncQQProfileMemberships(profileId);
    return await attachQQSession(authJson({ ok: true, redirectTo: safeReturnTo(returnTo) }), profileId, remember);
  } catch (error) {
    return qqAuthError(error);
  } finally {
    // Discard the transient Auth session; no Auth access/refresh tokens leave the server.
    await auth.auth.signOut({ scope: parsed.data.purpose === "reset" ? "global" : "local" }).catch(() => undefined);
  }
}
