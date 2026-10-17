import { hasSameOrigin } from "@/lib/security/request-origin";
import { safeReturnTo } from "@/lib/security/token";
import { qqEmailAddress, qqPasswordLoginSchema } from "@/lib/validation/qq-auth";
import { allowQQEmailAttempt, attachQQSession, authJson, createEmailAuthClient, markQQPasswordSet, qqAuthError } from "@/lib/auth/qq-email";
import { resolveQQProfile, syncQQProfileMemberships } from "@/lib/auth/qq-profile";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return authJson({ error: "请求来源无效。" }, 403);
  const parsed = qqPasswordLoginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return authJson({ error: parsed.error.issues[0]?.message ?? "登录信息无效。" }, 400);
  const auth = createEmailAuthClient();
  try {
    if (!await allowQQEmailAttempt(request, parsed.data.qq, "password")) {
      return authJson({ error: "密码尝试过多，请稍后再试或找回密码。" }, 429);
    }
    const email = qqEmailAddress(parsed.data.qq);
    const { data, error } = await auth.auth.signInWithPassword({ email, password: parsed.data.password });
    if (error || !data.user || data.user.email?.toLowerCase() !== email || !data.user.email_confirmed_at) {
      return authJson({ error: "QQ 号或密码错误，请重新输入或找回密码。" }, 400);
    }
    const profileId = await resolveQQProfile(parsed.data.qq, { verifiedAuthUserId: data.user.id });
    await markQQPasswordSet(data.user);
    await syncQQProfileMemberships(profileId);
    return await attachQQSession(authJson({ ok: true, redirectTo: safeReturnTo(parsed.data.returnTo) }), profileId, parsed.data.remember);
  } catch (error) {
    return qqAuthError(error);
  } finally {
    await auth.auth.signOut({ scope: "local" }).catch(() => undefined);
  }
}
