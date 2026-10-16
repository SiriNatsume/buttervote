import { hasSameOrigin } from "@/lib/security/request-origin";
import { qqEmailAddress, qqEmailSendSchema } from "@/lib/validation/qq-auth";
import { allowQQEmailAttempt, authJson, createEmailAuthClient } from "@/lib/auth/qq-email";
import { createRequiredServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return authJson({ error: "请求来源无效。" }, 403);
  const parsed = qqEmailSendSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return authJson({ error: "请输入有效的数字 QQ 号。" }, 400);
  try {
    if (!await allowQQEmailAttempt(request, parsed.data.qq, "send")) {
      return authJson({ error: "发送过于频繁，请稍后再试。" }, 429);
    }
    const email = qqEmailAddress(parsed.data.qq);
    // Keep public signup disabled. Only this validated numeric-QQ path can
    // provision an unconfirmed Auth identity, with no voter profile yet.
    const provision = await createRequiredServiceClient().auth.admin.createUser({ email, email_confirm: false });
    if (provision.error && !["email_exists", "user_already_exists"].includes(provision.error.code ?? "")) {
      return authJson({ error: "验证码暂时无法发送，请稍后重试或使用 QQ Bot 登录。" }, 503);
    }
    const auth = createEmailAuthClient();
    let delivery = provision.data.user && !provision.data.user.email_confirmed_at
      ? await auth.auth.resend({ type: "signup", email })
      : await auth.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    // An existing but still unconfirmed identity follows the confirmation-code
    // path too. This does not enable signups or pre-confirm email ownership.
    if (delivery.error?.code === "signup_disabled") {
      delivery = await auth.auth.resend({ type: "signup", email });
    }
    if (delivery.error) return authJson({ error: "验证码暂时无法发送，请稍后重试或使用 QQ Bot 登录。" }, 503);
    return authJson({ ok: true, message: "验证码已发送，请查看你的 QQ 邮箱。" });
  } catch {
    return authJson({ error: "登录服务暂时不可用，请稍后重试。" }, 503);
  }
}
