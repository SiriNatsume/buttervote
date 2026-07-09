"use client";

import { useEffect, useTransition } from "react";
import { RotateCcw, Archive, Pause, Play, SkipBack, SkipForward, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  controlContestCallingSessionAction,
  generateContestCallingSessionAction,
} from "@/lib/actions/contest-calling-actions";
import { toUserFacingError } from "@/lib/action-error";
import type { ContestCallingSession } from "@/lib/types";

type CallingSessionControl = Pick<
  ContestCallingSession,
  | "id"
  | "status"
  | "current_step"
  | "total_steps"
  | "play_mode"
  | "auto_interval_seconds"
> | null;

type ActionResult =
  | { ok?: boolean; error?: string; message?: string }
  | void;

function actionMessage(result: ActionResult, fallback: string) {
  if (result && "message" in result && result.message) {
    return result.message;
  }
  return fallback;
}

function statusText(status: ContestCallingSession["status"]) {
  if (status === "completed") {
    return "已完成";
  }
  if (status === "active") {
    return "进行中";
  }
  if (status === "paused") {
    return "已暂停";
  }
  if (status === "archived") {
    return "已归档";
  }
  return "草稿";
}

export function ContestCallingAdminPanel({
  contestId,
  session,
  canGenerate,
}: {
  contestId: string;
  session: CallingSessionControl;
  canGenerate: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const currentStep = session ? Math.max(0, Number(session.current_step) || 0) : 0;
  const totalSteps = session ? Math.max(0, Number(session.total_steps) || 0) : 0;
  const canGoPrevious = Boolean(session && currentStep > 0 && session.status !== "archived");
  const canGoNext = Boolean(session && currentStep < totalSteps && session.status !== "archived");

  function runAction(
    action: (formData: FormData) => Promise<ActionResult>,
    formData: FormData,
    successMessage: string,
  ) {
    if (isPending) {
      return;
    }

    startTransition(async () => {
      try {
        const result = await action(formData);
        if (result?.ok === false) {
          toast.error(toUserFacingError(result.error));
          return;
        }
        toast.success(actionMessage(result, successMessage));
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? toUserFacingError(error.message) : toUserFacingError());
      }
    });
  }

  function generate() {
    const formData = new FormData();
    formData.set("contestId", contestId);
    formData.set("autoIntervalSeconds", "5");
    runAction(generateContestCallingSessionAction, formData, "已生成唱票。");
  }

  function control(intent: string, extra?: Record<string, string>) {
    if (!session) {
      return;
    }
    const formData = new FormData();
    formData.set("sessionId", session.id);
    formData.set("intent", intent);
    for (const [key, value] of Object.entries(extra ?? {})) {
      formData.set(key, value);
    }
    runAction(controlContestCallingSessionAction, formData, "唱票状态已更新。");
  }

  useEffect(() => {
    if (
      !session ||
      session.status !== "active" ||
      session.play_mode !== "auto" ||
      currentStep >= totalSteps ||
      isPending
    ) {
      return;
    }

    const timeout = window.setTimeout(() => {
      control("next", { source: "auto" });
    }, Math.max(2, Number(session.auto_interval_seconds) || 5) * 1000);

    return () => window.clearTimeout(timeout);
  }, [session, currentStep, totalSteps, isPending]);

  return (
    <Card className="border-[#F0D08A] bg-[#FFF8E8]">
      <CardHeader>
        <CardTitle>管理员唱票工具</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {session ? (
            <>
              <span>当前：第 {currentStep} / {totalSteps} 张</span>
              <span>模式：{session.play_mode === "auto" ? "自动" : "手动"}</span>
              <span>状态：{statusText(session.status)}</span>
            </>
          ) : (
            <span>还没有唱票会话。</span>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={generate}
            disabled={isPending || !canGenerate}
          >
            <Wand2 className="size-4" />
            生成唱票
          </Button>
          {session ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => control(session.status === "draft" ? "start" : "resume")}
                disabled={isPending || session.status === "completed"}
              >
                <Play className="size-4" />
                开始/继续
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => control("previous")}
                disabled={isPending || !canGoPrevious}
              >
                <SkipBack className="size-4" />
                上一张
              </Button>
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={() => control("next")}
                disabled={isPending || !canGoNext}
              >
                <SkipForward className="size-4" />
                下一张
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => control("auto", { autoIntervalSeconds: String(session.auto_interval_seconds || 5) })}
                disabled={isPending || !canGoNext}
              >
                <RotateCcw className="size-4" />
                自动播放
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => control(session.play_mode === "auto" ? "manual" : "pause")}
                disabled={isPending || session.status === "completed"}
              >
                <Pause className="size-4" />
                手动暂停
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => control("complete")}
                disabled={isPending || session.status === "completed"}
              >
                完成唱票
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => control("archive")}
                disabled={isPending}
              >
                <Archive className="size-4" />
                归档唱票
              </Button>
            </>
          ) : null}
        </div>

        {!canGenerate ? (
          <p className="text-sm text-muted-foreground">
            唱票需要在活动关闭或结果发布后生成。
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}