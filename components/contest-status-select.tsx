"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updateContestStatusAction } from "@/lib/actions/admin-actions";
import { toUserFacingError } from "@/lib/action-error";
import type { ContestStatus } from "@/lib/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const statuses: Array<{ value: ContestStatus; label: string }> = [
  { value: "draft", label: "草稿" },
  { value: "nominating", label: "提名中" },
  { value: "admin_nominating", label: "管理员提名" },
  { value: "waiting", label: "等待开始" },
  { value: "voting", label: "投票中" },
  { value: "closed", label: "已结束" },
  { value: "published", label: "已发布" },
];

export function ContestStatusSelect({
  contestId,
  currentStatus,
}: {
  contestId: string;
  currentStatus: ContestStatus;
}) {
  const [value, setValue] = useState<ContestStatus>(currentStatus);
  const [isPending, startTransition] = useTransition();

  return (
    <Select
      value={value}
      disabled={isPending}
      onValueChange={(nextValue) => {
        const nextStatus = nextValue as ContestStatus;
        const previousStatus = value;
        setValue(nextStatus);
        startTransition(async () => {
          try {
            const result = await updateContestStatusAction(contestId, nextStatus);

            if (!result.ok) {
              setValue(previousStatus);
              toast.error(toUserFacingError(result.error));
              return;
            }

            toast.success(result.message ?? "状态已更新");
          } catch (error) {
            setValue(previousStatus);
            toast.error(
              toUserFacingError(
                error instanceof Error ? error.message : "状态更新失败，请稍后重试。",
              ),
            );
          }
        });
      }}
    >
      <SelectTrigger className="w-full sm:w-[180px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {statuses.map((status) => (
          <SelectItem key={status.value} value={status.value}>
            {status.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
