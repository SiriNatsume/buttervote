import { redirect } from "next/navigation";
import Image from "next/image";
import { LogIn, UserPlus } from "lucide-react";
import { loginAction, signUpAction } from "@/lib/actions/auth-actions";
import { getCurrentProfile } from "@/lib/auth";
import { FormStatusFieldset } from "@/components/form-status-fieldset";
import { FormSubmitButton } from "@/components/form-submit-button";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import logo from "@/img/网站logo.png";

const errorMessage: Record<string, string> = {
  qq_ticket_missing: "登录链接缺少 token。",
  qq_ticket_invalid: "登录链接无效或已过期，请回到 QQ 重新获取。",
  qq_ticket_used: "登录链接已被使用，请重新获取。",
  qq_ticket_expired: "登录链接已过期，请重新获取。",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (profile) {
    redirect("/");
  }

  const params = await searchParams;

  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md items-center px-4 py-12">
      <Card className="w-full">
        <CardHeader className="items-center text-center">
          <Image
            src={logo}
            alt="Butter Vote logo"
            className="h-16 w-auto object-contain"
            priority
          />
        </CardHeader>
        <CardContent>
          {params.error ? (
            <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {errorMessage[params.error] ?? params.error}
            </div>
          ) : null}
          {params.notice === "email_confirmation_sent" ? (
            <div className="mb-4 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm leading-6 text-primary">
              <p>验证邮件已发送，请前往邮箱点击验证链接完成注册。</p>
              <p>如果没有收到邮件，请检查垃圾邮件箱。</p>
            </div>
          ) : null}
          <div className="mb-5 rounded-xl border bg-muted/40 px-4 py-3 text-sm leading-6 text-muted-foreground">
            网站邮箱注册已经关闭，请通过私聊 Potato 发送指令“/login”获取登录链接。
          </div>
          <form>
            <FormStatusFieldset className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">邮箱</Label>
                <Input id="email" name="email" type="email" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">密码</Label>
                <Input id="password" name="password" type="password" required />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormSubmitButton formAction={loginAction} loadingText="登录中...">
                  <LogIn className="size-4" />
                  登录
                </FormSubmitButton>
                <FormSubmitButton
                  formAction={signUpAction}
                  variant="outline"
                  loadingText="注册中..."
                >
                  <UserPlus className="size-4" />
                  注册
                </FormSubmitButton>
              </div>
            </FormStatusFieldset>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
