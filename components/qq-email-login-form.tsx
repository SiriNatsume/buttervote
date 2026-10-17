"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Eye, EyeOff, KeyRound, Mail, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { qqAccountSchema, qqEmailVerifySchema, qqPasswordLoginSchema } from "@/lib/validation/qq-auth";

type Step = "qq" | "password" | "register" | "setup" | "reset";
type Action = "start" | "send" | "password" | "verify";
const accountSteps: Step[] = ["password", "register", "setup", "reset"];

export function QQEmailLoginForm({ returnTo, initialQQ = "", mode = "login" }: {
  returnTo: string;
  initialQQ?: string;
  mode?: "login" | "reset";
}) {
  const router = useRouter();
  const [qq, setQQ] = useState(initialQQ);
  const [step, setStep] = useState<Step>("qq");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [sentTo, setSentTo] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [pending, setPending] = useState<Action | null>(null);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const verifying = step === "register" || step === "setup" || step === "reset";
  const purpose = mode === "reset" ? "reset" : "register";
  const resetHref = `/forgot-password?${new URLSearchParams({ qq: qq.trim(), returnTo })}`;
  const loginHref = `/login?${new URLSearchParams({ qq: qq.trim(), returnTo })}`;

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  function changeQQ() {
    setStep("qq");
    setCode("");
    setPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    setError("");
  }

  async function submit(action: Action) {
    if (busy.current) return;
    const input = { qq, code, password, confirmPassword, remember, returnTo, purpose };
    const parsed = action === "verify" ? qqEmailVerifySchema.safeParse(input)
      : action === "password" ? qqPasswordLoginSchema.safeParse(input)
        : qqAccountSchema.safeParse(input);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "请检查输入内容。"); return; }
    busy.current = true;
    setPending(action);
    setError("");
    try {
      const response = await fetch(`/api/auth/qq-email/${action}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, qq: parsed.data.qq }),
      });
      const result = await response.json();
      if (accountSteps.includes(result.step)) {
        setStep(result.step);
        if (result.step === "password" && step !== "password") {
          setPassword("");
          setConfirmPassword("");
          setCode("");
        }
      }
      if (!response.ok || !result.ok) {
        setError(result.error || "操作失败，请稍后重试。");
        if (result.retryAfter) setCooldown(result.retryAfter);
        return;
      }
      setQQ(parsed.data.qq);
      if (action === "send" || (action === "start" && result.step !== "password")) {
        setSentTo(parsed.data.qq);
        setCooldown(result.retryAfter ?? 60);
        setCode("");
      } else if (action === "password" || action === "verify") {
        setPassword("");
        setConfirmPassword("");
        router.replace(result.redirectTo);
        router.refresh();
      }
    } catch {
      setError("网络连接不稳定，请稍后再试。");
    } finally {
      busy.current = false;
      setPending(null);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void submit(step === "qq" ? mode === "reset" ? "send" : "start" : step === "password" ? "password" : "verify");
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {mode === "reset" ? (
        <div className="space-y-2 text-center">
          <h1 className="text-xl font-semibold">重设密码</h1>
          <p className="text-sm text-muted-foreground">验证你的 QQ 邮箱后，即可设置新密码。</p>
        </div>
      ) : null}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="qq-number">QQ 号</Label>
          {step !== "qq" ? (
            <button type="button" className="text-sm text-primary hover:underline disabled:opacity-50"
              disabled={Boolean(pending)} onClick={changeQQ}>更换 QQ 号</button>
          ) : null}
        </div>
        <Input id="qq-number" name="qq" inputMode="numeric" autoComplete="username"
          placeholder="输入你的 QQ 号" value={qq} maxLength={12} required
          readOnly={step !== "qq"} disabled={Boolean(pending)}
          onChange={(event) => { setQQ(event.target.value); setSentTo(""); setError(""); }} />
        {step === "qq" && mode === "reset" ? <p className="text-sm text-muted-foreground">
          验证码将发送到此 QQ 号对应的 QQ 邮箱。
        </p> : null}
      </div>
      {verifying && sentTo === qq.trim() ? (
        <div role="status" className="flex items-start gap-2 rounded-xl border border-primary/20 bg-primary/5 px-3 py-3 text-sm">
          <Mail className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0 space-y-1">
            <p className="break-all">验证码已发送到 {sentTo}@qq.com</p>
            <p className="text-xs text-muted-foreground">10 分钟内有效，未收到时请检查垃圾邮件。</p>
          </div>
        </div>
      ) : null}
      {step === "register" ? <p className="text-sm text-muted-foreground">此 QQ 号尚未注册，验证邮箱并设置密码后将自动注册、登录。</p> : null}
      {step === "setup" ? <p className="text-sm text-muted-foreground">原账号还未设置密码。验证邮箱后设置密码，即可继续使用原账号和投票记录。</p> : null}
      {verifying ? (
        <div className="space-y-2">
          <Label htmlFor="qq-code">邮箱验证码</Label>
          <div className="flex gap-2">
            <Input id="qq-code" name="code" inputMode="numeric" autoComplete="one-time-code" autoFocus
              className="min-w-0" placeholder="8 位验证码" value={code} pattern="[0-9]{8}" maxLength={8} required
              disabled={Boolean(pending)} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} />
            <Button type="button" variant="outline" size="sm" disabled={Boolean(pending) || cooldown > 0}
              onClick={() => void submit("send")}>
              {pending === "send" ? "发送中…" : cooldown > 0 ? `${cooldown} 秒后重发` : "重新发送"}
            </Button>
          </div>
        </div>
      ) : null}
      {step !== "qq" ? (
        <div className="space-y-2">
          <Label htmlFor="qq-password">{step === "password" ? "密码" : step === "reset" ? "新密码" : "设置密码"}</Label>
          <div className="relative">
            <Input id="qq-password" name="password" type={showPassword ? "text" : "password"}
              className="pr-11" autoComplete={step === "password" ? "current-password" : "new-password"}
              autoFocus={step === "password"} placeholder={step === "password" ? "输入你的密码" : "至少 8 位"}
              value={password} required minLength={verifying ? 8 : 1} maxLength={verifying ? 72 : 1024}
              disabled={Boolean(pending)} onChange={(event) => setPassword(event.target.value)} />
            <button type="button" className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground"
              disabled={Boolean(pending)} aria-label={showPassword ? "隐藏密码" : "显示密码"}
              aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)}>
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>
      ) : null}
      {verifying ? (
        <div className="space-y-2">
          <Label htmlFor="qq-confirm-password">确认密码</Label>
          <Input id="qq-confirm-password" name="confirmPassword" type={showPassword ? "text" : "password"}
            autoComplete="new-password" placeholder="再次输入密码" value={confirmPassword} required minLength={8} maxLength={72}
            disabled={Boolean(pending)} onChange={(event) => setConfirmPassword(event.target.value)} />
        </div>
      ) : null}
      {step !== "qq" ? (
        <div className="flex items-center justify-between gap-3 text-sm">
          <div className="flex items-center gap-2">
            <Checkbox id="qq-remember" name="remember" checked={remember} disabled={Boolean(pending)}
              onCheckedChange={(checked) => setRemember(checked === true)} />
            <Label htmlFor="qq-remember" className="cursor-pointer text-sm font-normal">记住密码</Label>
          </div>
          {mode === "login" ? <Link href={resetHref} className="text-primary hover:underline">忘记密码？</Link> : null}
        </div>
      ) : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" className="w-full" disabled={Boolean(pending) || !qq.trim() || (verifying && code.length !== 8)}>
        {step === "qq" ? <ArrowRight className="size-4" /> : step === "reset" ? <KeyRound className="size-4" /> : <LogIn className="size-4" />}
        {pending ? pending === "start" ? "识别账号中…" : pending === "send" ? "发送中…" : pending === "password" ? "登录中…" : "验证并保存中…"
          : step === "qq" ? mode === "reset" ? "发送验证码" : "下一步"
            : step === "password" ? "登录" : step === "register" ? "注册并登录" : step === "reset" ? "重设密码并登录" : "设置密码并登录"}
      </Button>
      {step !== "qq" ? <p className="text-center text-xs leading-5 text-muted-foreground">勾选后将在此设备保持登录，请仅在自己的设备上使用。</p> : null}
      {mode === "reset" ? <Link href={loginHref} className="flex items-center justify-center gap-1 text-sm text-primary hover:underline"><ArrowLeft className="size-4" />返回登录</Link>
        : step === "qq" ? <p className="text-center"><Link href={resetHref} className="text-sm text-primary hover:underline">忘记密码？</Link></p> : null}
    </form>
  );
}
