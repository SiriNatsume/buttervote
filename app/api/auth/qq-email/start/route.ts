import { hasSameOrigin } from "@/lib/security/request-origin";
import { qqAccountSchema } from "@/lib/validation/qq-auth";
import { allowQQEmailAttempt, authJson, getQQEmailAccountState, qqAuthError, sendQQEmailCode } from "@/lib/auth/qq-email";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return authJson({ error: "请求来源无效。" }, 403);
  const parsed = qqAccountSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return authJson({ error: "请输入有效的数字 QQ 号。" }, 400);
  try {
    if (!await allowQQEmailAttempt(request, parsed.data.qq, "lookup")) {
      return authJson({ error: "操作过于频繁，请稍后再试。" }, 429);
    }
    const state = await getQQEmailAccountState(parsed.data.qq);
    if (state.has_password && state.email_confirmed) {
      return authJson({ ok: true, step: "password" });
    }
    return await sendQQEmailCode(request, parsed.data.qq, "register");
  } catch (error) {
    return qqAuthError(error);
  }
}
