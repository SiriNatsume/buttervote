"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, CheckSquare, Square, X } from "lucide-react";
import { toast } from "sonner";
import { batchUpdateGroupContestSchedule } from "@/lib/actions/admin-actions";
import { toUserFacingError } from "@/lib/action-error";
import { statusLabel } from "@/lib/contest-rules";
import { formatDateTime } from "@/lib/time";
import type { ContestStatus } from "@/lib/types";
import { LoadingButton } from "@/components/loading-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type GroupScheduleContest = {
  id: string;
  title: string;
  status: ContestStatus;
  voting_starts_at: string | null;
  voting_ends_at: string | null;
};

type BatchActionName = "status" | "start" | "end" | "all";

type BatchPayload = {
  status?: ContestStatus;
  votingStartAt?: string | null;
  votingEndAt?: string | null;
};

type PendingBatchRequest = {
  actionName: BatchActionName;
  title: string;
  description: string;
  contestIds: string[];
  payload: BatchPayload;
};

const statuses: ContestStatus[] = [
  "draft",
  "nominating",
  "admin_nominating",
  "waiting",
  "voting",
  "closed",
  "published",
];

export function GroupScheduleBatchPanel({
  groupId,
  contests,
}: {
  groupId: string;
  contests: GroupScheduleContest[];
}) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [status, setStatus] = useState<ContestStatus>("waiting");
  const [votingStartAt, setVotingStartAt] = useState("");
  const [votingEndAt, setVotingEndAt] = useState("");
  const [pendingAction, setPendingAction] = useState<BatchActionName | null>(null);
  const [pendingBatchRequest, setPendingBatchRequest] =
    useState<PendingBatchRequest | null>(null);
  const [, startTransition] = useTransition();

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allSelected =
    contests.length > 0 && selectedIds.length === contests.length;
  const pendingBatchContestNames = pendingBatchRequest
    ? contests
        .filter((contest) => pendingBatchRequest.contestIds.includes(contest.id))
        .map((contest) => contest.title)
    : [];

  function toggleAll() {
    setSelectedIds(allSelected ? [] : contests.map((contest) => contest.id));
  }

  function toggleContest(contestId: string, checked: boolean) {
    setSelectedIds((current) =>
      checked
        ? [...new Set([...current, contestId])]
        : current.filter((id) => id !== contestId),
    );
  }

  function requestBatch(
    actionName: BatchActionName,
    payload: BatchPayload,
    title: string,
    description: string,
  ) {
    if (pendingAction) {
      return;
    }

    if (selectedIds.length === 0) {
      toast.error("请至少选择一个活动");
      return;
    }

    setPendingBatchRequest({
      actionName,
      title,
      description,
      contestIds: selectedIds,
      payload,
    });
  }

  function submitPendingBatch() {
    if (!pendingBatchRequest || pendingAction) {
      return;
    }

    setPendingAction(pendingBatchRequest.actionName);
    startTransition(async () => {
      try {
        const result = await batchUpdateGroupContestSchedule({
          groupId,
          contestIds: pendingBatchRequest.contestIds,
          ...pendingBatchRequest.payload,
        });

        if (!result.ok) {
          toast.error(toUserFacingError(result.error));
          return;
        }

        toast.success(result.message ?? "批量设置已保存");
        setPendingBatchRequest(null);
        router.refresh();
      } catch (error) {
        toast.error(
          toUserFacingError(
            error instanceof Error ? error.message : "批量设置失败，请稍后重试。",
          ),
        );
      } finally {
        setPendingAction(null);
      }
    });
  }

  if (contests.length === 0) {
    return (
      <div className="rounded-2xl border p-5 text-sm text-muted-foreground">
        当前活动组暂无可批量设置的活动。
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-2xl border border-[#EED8AA]/70 bg-[#FFF8E8]/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="font-medium">已选择 {selectedIds.length} 项</div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={Boolean(pendingAction)}
            onClick={toggleAll}
          >
            {allSelected ? (
              <Square className="size-4" />
            ) : (
              <CheckSquare className="size-4" />
            )}
            {allSelected ? "取消全选" : "全选"}
          </Button>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-2">
            <Label>当前状态</Label>
            <Select
              value={status}
              onValueChange={(value) => setStatus(value as ContestStatus)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statuses.map((item) => (
                  <SelectItem key={item} value={item}>
                    {statusLabel[item]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="batch-voting-start">投票开始时间</Label>
            <div className="flex gap-2">
              <Input
                id="batch-voting-start"
                type="datetime-local"
                value={votingStartAt}
                onChange={(event) => setVotingStartAt(event.target.value)}
              />
              <Button
                type="button"
                size="icon"
                variant="outline"
                aria-label="清除投票开始时间"
                disabled={!votingStartAt}
                onClick={() => setVotingStartAt("")}
              >
                <X className="size-4" />
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="batch-voting-end">投票结束时间</Label>
            <div className="flex gap-2">
              <Input
                id="batch-voting-end"
                type="datetime-local"
                value={votingEndAt}
                onChange={(event) => setVotingEndAt(event.target.value)}
              />
              <Button
                type="button"
                size="icon"
                variant="outline"
                aria-label="清除投票结束时间"
                disabled={!votingEndAt}
                onClick={() => setVotingEndAt("")}
              >
                <X className="size-4" />
              </Button>
            </div>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <LoadingButton
            type="button"
            variant="outline"
            loading={pendingAction === "status"}
            loadingText="保存中..."
            disabled={Boolean(pendingAction)}
            onClick={() =>
              requestBatch(
                "status",
                { status },
                "确认批量更新状态？",
                `将把 ${selectedIds.length} 个活动的状态改为「${statusLabel[status]}」。这会影响用户能否提名、投票或查看结果，请确认后再继续。`,
              )
            }
          >
            批量更新状态
          </LoadingButton>
          <LoadingButton
            type="button"
            variant="outline"
            loading={pendingAction === "start"}
            loadingText="保存中..."
            disabled={Boolean(pendingAction)}
            onClick={() =>
              requestBatch(
                "start",
                { votingStartAt: votingStartAt || null },
                "确认批量设置开始时间？",
                `将为 ${selectedIds.length} 个活动同步投票开始时间和定时任务。留空会清除未执行的开始定时任务。`,
              )
            }
          >
            批量设置定时开始
          </LoadingButton>
          <LoadingButton
            type="button"
            variant="outline"
            loading={pendingAction === "end"}
            loadingText="保存中..."
            disabled={Boolean(pendingAction)}
            onClick={() =>
              requestBatch(
                "end",
                { votingEndAt: votingEndAt || null },
                "确认批量设置结束时间？",
                `将为 ${selectedIds.length} 个活动同步投票结束时间和定时任务。留空会清除未执行的结束定时任务。`,
              )
            }
          >
            批量设置定时结束
          </LoadingButton>
          <LoadingButton
            type="button"
            loading={pendingAction === "all"}
            loadingText="保存中..."
            disabled={Boolean(pendingAction)}
            onClick={() =>
              requestBatch(
                "all",
                {
                  status,
                  votingStartAt: votingStartAt || null,
                  votingEndAt: votingEndAt || null,
                },
                "确认批量保存状态与定时任务？",
                `将一次性修改 ${selectedIds.length} 个活动的状态、投票时间和定时任务。该操作会直接影响用户参与入口，请确认。`,
              )
            }
          >
            <CalendarClock className="size-4" />
            批量保存状态与定时任务
          </LoadingButton>
        </div>
      </div>

      <div className="hidden rounded-2xl border border-[#EED8AA]/70 md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12" />
              <TableHead>活动</TableHead>
              <TableHead>当前状态</TableHead>
              <TableHead>投票开始时间</TableHead>
              <TableHead>投票结束时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contests.map((contest) => (
              <TableRow key={contest.id}>
                <TableCell>
                  <Checkbox
                    checked={selectedSet.has(contest.id)}
                    disabled={Boolean(pendingAction)}
                    onCheckedChange={(value) =>
                      toggleContest(contest.id, value === true)
                    }
                  />
                </TableCell>
                <TableCell className="font-medium">{contest.title}</TableCell>
                <TableCell>{statusLabel[contest.status]}</TableCell>
                <TableCell>{formatDateTime(contest.voting_starts_at)}</TableCell>
                <TableCell>{formatDateTime(contest.voting_ends_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="space-y-3 md:hidden">
        {contests.map((contest) => (
          <label
            key={contest.id}
            className="block rounded-2xl border border-[#EED8AA]/70 bg-[#FFFCF4]/85 p-4"
          >
            <div className="flex items-start gap-3">
              <Checkbox
                checked={selectedSet.has(contest.id)}
                disabled={Boolean(pendingAction)}
                onCheckedChange={(value) =>
                  toggleContest(contest.id, value === true)
                }
              />
              <div className="min-w-0">
                <div className="break-words font-medium">{contest.title}</div>
                <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                  <div>当前状态：{statusLabel[contest.status]}</div>
                  <div>投票开始时间：{formatDateTime(contest.voting_starts_at)}</div>
                  <div>投票结束时间：{formatDateTime(contest.voting_ends_at)}</div>
                </div>
              </div>
            </div>
          </label>
        ))}
      </div>

      <Dialog
        open={Boolean(pendingBatchRequest)}
        onOpenChange={(open) => {
          if (!open && !pendingAction) {
            setPendingBatchRequest(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pendingBatchRequest?.title ?? "确认批量操作？"}</DialogTitle>
            <DialogDescription>
              {pendingBatchRequest?.description}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-48 space-y-2 overflow-y-auto rounded-2xl border border-[#EED8AA]/70 bg-[#FFF8E8]/60 p-3 text-sm">
            {pendingBatchContestNames.map((name, index) => (
              <div key={`${name}-${index}`} className="break-words">
                {name}
              </div>
            ))}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={Boolean(pendingAction)}
              onClick={() => setPendingBatchRequest(null)}
            >
              取消
            </Button>
            <LoadingButton
              type="button"
              loading={Boolean(pendingAction)}
              loadingText="保存中..."
              onClick={submitPendingBatch}
            >
              确认保存
            </LoadingButton>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
