"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckSquare, Heart, Settings2, Square } from "lucide-react";
import { toast } from "sonner";
import { batchUpdateGroupContestVotingSettings } from "@/lib/actions/admin-actions";
import { toUserFacingError } from "@/lib/action-error";
import { LoadingButton } from "@/components/loading-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

type GroupContestVotingSettingsContest = {
  id: string;
  title: string;
  love_vote_enabled: boolean;
  both_support_enabled: boolean;
  live_results_enabled: boolean;
};

type SettingValue = "on" | "off";
type BatchActionName = "love" | "live" | "support" | "both";

type BatchPayload = {
  loveVoteEnabled?: boolean;
  bothSupportEnabled?: boolean;
  liveResultsEnabled?: boolean;
};

type PendingBatchRequest = {
  actionName: BatchActionName;
  title: string;
  description: string;
  contestIds: string[];
  payload: BatchPayload;
};

function valueToBoolean(value: SettingValue) {
  return value === "on";
}

function valueLabel(value: SettingValue) {
  return value === "on" ? "开启" : "关闭";
}

function SettingBadge({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <Badge variant="secondary">已开启</Badge>
  ) : (
    <Badge variant="outline">已关闭</Badge>
  );
}

export function GroupContestSettingsBatchPanel({
  groupId,
  contests,
}: {
  groupId: string;
  contests: GroupContestVotingSettingsContest[];
}) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loveVoteValue, setLoveVoteValue] = useState<SettingValue>("on");
  const [bothSupportValue, setBothSupportValue] = useState<SettingValue>("on");
  const [liveResultsValue, setLiveResultsValue] = useState<SettingValue>("on");
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
      toast.error("请至少选择一个活动。");
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
        const result = await batchUpdateGroupContestVotingSettings({
          groupId,
          contestIds: pendingBatchRequest.contestIds,
          ...pendingBatchRequest.payload,
        });

        if (!result.ok) {
          toast.error(toUserFacingError(result.error));
          return;
        }

        toast.success(result.message ?? "批量投票设置已保存");
        setPendingBatchRequest(null);
        router.refresh();
      } catch (error) {
        toast.error(
          toUserFacingError(
            error instanceof Error
              ? error.message
              : "批量投票设置失败，请稍后重试。",
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
      <div className="flex flex-col gap-4 rounded-2xl border border-[#EED8AA]/70 bg-[#FFF8E8]/60 p-4">
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
            <Label>允许同时支持两项</Label>
            <Select value={bothSupportValue} onValueChange={(value) => setBothSupportValue(value as SettingValue)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="on">开启</SelectItem><SelectItem value="off">关闭</SelectItem></SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">仅对恰好两个有效候选项的单选活动生效。</p>
          </div>
          <div className="space-y-2">
            <Label>允许使用真爱票</Label>
            <Select
              value={loveVoteValue}
              onValueChange={(value) => setLoveVoteValue(value as SettingValue)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="on">开启</SelectItem>
                <SelectItem value="off">关闭</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>投票结果实时公开</Label>
            <Select
              value={liveResultsValue}
              onValueChange={(value) => setLiveResultsValue(value as SettingValue)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="on">开启</SelectItem>
                <SelectItem value="off">关闭</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <LoadingButton type="button" variant="outline" loading={pendingAction === "support"}
            loadingText="保存中..." disabled={Boolean(pendingAction)}
            onClick={() => requestBatch("support", { bothSupportEnabled: valueToBoolean(bothSupportValue) },
              "确认批量更新同时支持开关？", `将把 ${selectedIds.length} 个活动的“允许同时支持两项”设为“${valueLabel(bothSupportValue)}”。已提交的选票不受影响。`)}>
            批量保存同时支持
          </LoadingButton>
          <LoadingButton
            type="button"
            variant="outline"
            loading={pendingAction === "love"}
            loadingText="保存中..."
            disabled={Boolean(pendingAction)}
            onClick={() =>
              requestBatch(
                "love",
                { loveVoteEnabled: valueToBoolean(loveVoteValue) },
                "确认批量更新真爱票开关？",
                `将把 ${selectedIds.length} 个活动的“允许使用真爱票”设为“${valueLabel(loveVoteValue)}”。`,
              )
            }
          >
            <Heart className="size-4" />
            批量保存真爱票
          </LoadingButton>
          <LoadingButton
            type="button"
            variant="outline"
            loading={pendingAction === "live"}
            loadingText="保存中..."
            disabled={Boolean(pendingAction)}
            onClick={() =>
              requestBatch(
                "live",
                { liveResultsEnabled: valueToBoolean(liveResultsValue) },
                "确认批量更新实时公开？",
                `将把 ${selectedIds.length} 个活动的“投票结果实时公开”设为“${valueLabel(liveResultsValue)}”。`,
              )
            }
          >
            批量保存实时公开
          </LoadingButton>
          <LoadingButton
            type="button"
            loading={pendingAction === "both"}
            loadingText="保存中..."
            disabled={Boolean(pendingAction)}
            onClick={() =>
              requestBatch(
                "both",
                {
                  loveVoteEnabled: valueToBoolean(loveVoteValue),
                  bothSupportEnabled: valueToBoolean(bothSupportValue),
                  liveResultsEnabled: valueToBoolean(liveResultsValue),
                },
                "确认批量保存投票设置？",
                `将一次性更新 ${selectedIds.length} 个活动的同时支持、真爱票和实时公开开关。`,
              )
            }
          >
            <Settings2 className="size-4" />
            批量保存全部设置
          </LoadingButton>
        </div>
      </div>

      <div className="hidden rounded-2xl border border-[#EED8AA]/70 md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12" />
              <TableHead>活动</TableHead>
              <TableHead>允许同时支持两项</TableHead>
              <TableHead>允许使用真爱票</TableHead>
              <TableHead>投票结果实时公开</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contests.map((contest) => (
              <TableRow key={contest.id}>
                <TableCell>
                  <Checkbox
                    aria-label={`选择活动：${contest.title}`}
                    checked={selectedSet.has(contest.id)}
                    disabled={Boolean(pendingAction)}
                    onCheckedChange={(value) =>
                      toggleContest(contest.id, value === true)
                    }
                  />
                </TableCell>
                <TableCell className="font-medium">{contest.title}</TableCell>
                <TableCell><SettingBadge enabled={contest.both_support_enabled} /></TableCell>
                <TableCell>
                  <SettingBadge enabled={contest.love_vote_enabled} />
                </TableCell>
                <TableCell>
                  <SettingBadge enabled={contest.live_results_enabled} />
                </TableCell>
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
                aria-label={`选择活动：${contest.title}`}
                checked={selectedSet.has(contest.id)}
                disabled={Boolean(pendingAction)}
                onCheckedChange={(value) =>
                  toggleContest(contest.id, value === true)
                }
              />
              <div className="min-w-0">
                <div className="break-words font-medium">{contest.title}</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                    同时支持<SettingBadge enabled={contest.both_support_enabled} />
                  </span>
                  <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                    真爱票
                    <SettingBadge enabled={contest.love_vote_enabled} />
                  </span>
                  <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                    实时公开
                    <SettingBadge enabled={contest.live_results_enabled} />
                  </span>
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
