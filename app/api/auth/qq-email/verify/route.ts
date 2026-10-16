import { hasSameOrigin } from "@/lib/security/request-origin";
import { safeReturnTo } from "@/lib/security/token";
import { qqEmailAddress, qqEmailVerifySchema } from "@/lib/validation/qq-auth";
import { allowQQEmailAttempt, attachQQSession, authJson, createEmailAuthClient } from "@/lib/auth/qq-email";
import { resolveQQProfile, syncQQProfileMemberships } from "@/lib/auth/qq-profile";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return authJson({ error: "请求来源无效。" }, 403);
  const parsed = qqEmailVerifySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return authJson({ error: "请输入有效的 QQ 号和 8 位验证码。" }, 400);
  const auth = createEmailAuthClient();
  try {
    if (!await allowQQEmailAttempt(request, parsed.data.qq, "verify")) {
      return authJson({ error: "验证尝试过多，请稍后再试。" }, 429);
    }
    const email = qqEmailAddress(parsed.data.qq);
    const { data, error } = await auth.auth.verifyOtp({ email, token: parsed.data.code, type: "email" });
    if (error || !data.user || data.user.email?.toLowerCase() !== email || !data.user.email_confirmed_at) {
      return authJson({ error: "验证码错误或已过期，请重新输入或获取。" }, 400);
    }
    const profileId = await resolveQQProfile(parsed.data.qq, { verifiedAuthUserId: data.user.id });
    await syncQQProfileMemberships(profileId);
    return await attachQQSession(authJson({ ok: true, redirectTo: safeReturnTo(parsed.data.returnTo) }), profileId);
  } catch (error) {
    if (error instanceof Error && error.message.includes("QQ_IDENTITY_CONFLICT")) {
      return authJson({ error: "检测到历史账号冲突，请使用原 QQ Bot 登录并联系管理员处理；投票记录已保留。" }, 409);
    }
    return authJson({ error: "登录服务暂时不可用，请稍后重试。" }, 503);
  } finally {
    // Discard the transient Auth session; no Auth access/refresh tokens leave the server.
    await auth.auth.signOut({ scope: "local" }).catch(() => undefined);
  }
}
