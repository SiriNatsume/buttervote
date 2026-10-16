"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Mail, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { qqNumberSchema } from "@/lib/validation/qq-auth";

export function QQEmailLoginForm({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const [qq, setQQ] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [pending, setPending] = useState<"send" | "verify" | null>(null);
  const [error, setError] = useState("");
  const busy = useRef(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function submit(action: "send" | "verify") {
    if (busy.current) return;
    const parsed = qqNumberSchema.safeParse(qq);
    if (!parsed.success) { setError("请输入有效的数字 QQ 号。"); return; }
    busy.current = true;
    setPending(action);
    setError("");
    try {
      const response = await fetch(`/api/auth/qq-email/${action}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qq: parsed.data, code, returnTo }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        setError(result.error || "操作失败，请稍后重试。");
        return;
      }
      if (action === "send") {
        setSentTo(parsed.data);
        setCooldown(60);
        setCode("");
      } else {
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
    void submit("verify");
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="qq-number">QQ 号</Label>
        <Input id="qq-number" name="qq" inputMode="numeric" autoComplete="username"
          placeholder="输入你的 QQ 号" value={qq} maxLength={12} required disabled={Boolean(pending)}
          onChange={(event) => { setQQ(event.target.value); setCode(""); setError(""); }} />
        <p className="text-sm text-muted-foreground">验证码将发送到此 QQ 号对应的 QQ 邮箱。</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="qq-code">邮箱验证码</Label>
        <div className="flex gap-2">
          <Input id="qq-code" name="code" inputMode="numeric" autoComplete="one-time-code"
            placeholder="8 位验证码" value={code} pattern="[0-9]{8}" maxLength={8} required
            disabled={Boolean(pending)} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} />
          <Button type="button" variant="outline" className="shrink-0"
            disabled={Boolean(pending) || cooldown > 0}
            onClick={() => void submit("send")}>
            {pending === "send" ? "发送中…" : cooldown > 0 ? `${cooldown} 秒后重发` : "发送验证码"}
          </Button>
        </div>
      </div>
      {sentTo && sentTo === qq.trim() ? (
        <p role="status" className="flex items-start gap-2 text-sm text-muted-foreground">
          <Mail className="mt-0.5 size-4 shrink-0" />
          已发送至 {sentTo}@qq.com，未收到时请检查垃圾邮件。
        </p>
      ) : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" className="w-full" disabled={Boolean(pending) || !qq || code.length !== 8}>
        <LogIn className="size-4" />{pending === "verify" ? "验证中…" : "登录并继续"}
      </Button>
      <p className="text-center text-xs text-muted-foreground">首次验证将自动创建账号，无需设置密码。</p>
    </form>
  );
}
