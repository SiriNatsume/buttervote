"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { revokeCurrentAppSession } from "@/lib/auth/app-session";
import { createClient } from "@/lib/supabase/server";
import { safeReturnTo } from "@/lib/security/token";

const credentialSchema = z.object({
  email: z.string().email("请输入有效邮箱。"),
  password: z.string().min(6, "密码至少 6 位。"),
});

function authErrorMessage(message?: string | null) {
  const text = message ?? "";

  if (/invalid login credentials/i.test(text)) {
    return "邮箱或密码错误。";
  }

  if (/email not confirmed/i.test(text)) {
    return "邮箱尚未验证，请先前往邮箱点击验证链接。";
  }

  if (/already registered|already exists|user already/i.test(text)) {
    return "该邮箱已注册。";
  }

  if (/password/i.test(text) && /at least|minimum|short/i.test(text)) {
    return "密码至少 6 位。";
  }

  if (/rate limit|too many/i.test(text)) {
    return "操作过于频繁，请稍后再试。";
  }

  return "操作失败，请稍后重试。";
}

function loginError(message: string): never {
  redirect(`/login?error=${encodeURIComponent(message)}`);
}

export async function loginAction(formData: FormData) {
  const parsed = credentialSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    loginError(parsed.error.issues[0]?.message ?? "登录信息无效。");
  }

  // Numeric QQ mailboxes must use the canonical QQ profile and app session.
  // The legacy Supabase-cookie path is kept only for other email accounts.
  const qq = parsed.data.email.match(/^([1-9][0-9]{4,11})@qq\.com$/i)?.[1];
  if (qq) {
    redirect(`/login?${new URLSearchParams({ qq, returnTo: safeReturnTo(String(formData.get("returnTo") ?? "/")), error: "请在上方使用 QQ 号和密码登录。" })}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    loginError(authErrorMessage(error.message));
  }

  redirect(safeReturnTo(String(formData.get("returnTo") ?? "/")));
}

export async function signUpAction(formData: FormData) {
  redirect(`/register?${new URLSearchParams({ returnTo: safeReturnTo(String(formData.get("returnTo") ?? "/")) })}`);
}

export async function logoutAction() {
  await revokeCurrentAppSession();

  const supabase = await createClient();
  await supabase.auth.signOut();

  redirect("/?loggedOut=1");
}
