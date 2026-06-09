"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, ImageIcon, X } from "lucide-react";
import { toast } from "sonner";
import {
  batchReviewNominations,
  reviewNominationAction,
} from "@/lib/actions/admin-actions";
import { toUserFacingError } from "@/lib/action-error";
import { getPublicImageUrl } from "@/lib/image/image-url";
import type { Nomination } from "@/lib/types";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type ReviewNomination = Nomination & {
  contests?: {
    title: string;
  } | null;
  profiles?: {
    id: string;
    display_name: string | null;
    email: string | null;
    qq_nickname: string | null;
    qq_user_id: string | null;
    login_provider: string | null;
  } | null;
};

type ReviewAction = "approve" | "reject";

function UserIdentity({
  profile,
  fallbackId,
}: {
  profile?: ReviewNomination["profiles"];
  fallbackId: string | null;
}) {
  if (!profile) {
    return (
      <div className="text-sm text-muted-foreground">
        {fallbackId ? `用户 ID：${fallbackId}` : "无提交用户"}
      </div>
    );
  }

  return (
    <div className="space-y-1 text-sm text-muted-foreground">
      <div className="font-medium text-foreground">
        {profile.display_name || profile.qq_nickname || profile.email || "未命名用户"}
      </div>
      {profile.qq_nickname ? <div>QQ 昵称：{profile.qq_nickname}</div> : null}
      {profile.qq_user_id ? <div>QQ：{profile.qq_user_id}</div> : null}
      {profile.email ? <div>邮箱：{profile.email}</div> : null}
      <div className="text-xs">ID：{profile.id}</div>
    </div>
  );
}

export function NominationReviewTable({
  nominations,
}: {
  nominations: ReviewNomination[];
}) {
  const [rows, setRows] = useState(nominations);
  const [pendingReview, setPendingReview] = useState<{
    id: string;
    action: ReviewAction;
  } | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchAction, setBatchAction] = useState<ReviewAction | null>(null);
  const [batchRejectReason, setBatchRejectReason] = useState("");
  const [singleRejectTarget, setSingleRejectTarget] =
    useState<ReviewNomination | null>(null);
  const [singleRejectReason, setSingleRejectReason] = useState("");
  const [isBatchPending, setIsBatchPending] = useState(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    setRows(nominations);
  }, [nominations]);

  useEffect(() => {
    const rowIds = new Set(rows.map((row) => row.id));
    setSelectedIds((current) => current.filter((id) => rowIds.has(id)));
  }, [rows]);

  const selectedSet = new Set(selectedIds);
  const allSelected = rows.length > 0 && selectedIds.length === rows.length;

  function toggleAll(checked: boolean) {
    setSelectedIds(checked ? rows.map((nomination) => nomination.id) : []);
  }

  function toggleSelected(nominationId: string, checked: boolean) {
    setSelectedIds((current) =>
      checked
        ? [...new Set([...current, nominationId])]
        : current.filter((id) => id !== nominationId),
    );
  }

  function handleReview(
    nominationId: string,
    reviewAction: ReviewAction,
    rejectionReason?: string,
  ) {
    if (pendingReview || isBatchPending) {
      return;
    }

    const formData = new FormData();
    formData.set("nominationId", nominationId);
    formData.set("reviewAction", reviewAction);
    if (reviewAction === "reject" && rejectionReason?.trim()) {
      formData.set("rejectionReason", rejectionReason.trim());
    }
    setPendingReview({ id: nominationId, action: reviewAction });

    startTransition(async () => {
      try {
        const result = await reviewNominationAction(formData);

        if (!result.ok) {
          toast.error(toUserFacingError(result.error));
          return;
        }

        setRows((current) =>
          current.filter((nomination) => nomination.id !== nominationId),
        );
        setSingleRejectTarget(null);
        setSingleRejectReason("");
        toast.success(result.message ?? "审核已更新");
      } catch (error) {
        toast.error(
          toUserFacingError(
            error instanceof Error ? error.message : "审核失败，请稍后重试。",
          ),
        );
      } finally {
        setPendingReview(null);
      }
    });
  }

  function handleBatchReview(
    reviewAction: ReviewAction,
    rejectionReason?: string,
  ) {
    if (isBatchPending || pendingReview) {
      return;
    }

    if (selectedIds.length === 0) {
      toast.error("请至少选择一条提名");
      return;
    }

    setIsBatchPending(true);
    startTransition(async () => {
      try {
        const result = await batchReviewNominations({
          nominationIds: selectedIds,
          action: reviewAction,
          rejectionReason: reviewAction === "reject" ? rejectionReason?.trim() : undefined,
        });

        if (!result.ok) {
          toast.error(toUserFacingError(result.error));
          return;
        }

        const reviewedIds = new Set(selectedIds);
        setRows((current) =>
          current.filter((nomination) => !reviewedIds.has(nomination.id)),
        );
        setSelectedIds([]);
        setBatchAction(null);
        setBatchRejectReason("");
        toast.success(result.message ?? "批量审核已完成");
      } catch (error) {
        toast.error(
          toUserFacingError(
            error instanceof Error ? error.message : "批量审核失败，请稍后重试。",
          ),
        );
      } finally {
        setIsBatchPending(false);
      }
    });
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border p-6 text-sm text-muted-foreground">
        暂无待审核提名。新的用户提名提交后会出现在这里。
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-[#EED8AA]/70 bg-[#FFF8E8]/60 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Checkbox
            checked={allSelected}
            onCheckedChange={(value) => toggleAll(value === true)}
            disabled={isBatchPending || Boolean(pendingReview)}
          />
          <span className="text-sm font-medium">已选择 {selectedIds.length} 项</span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Button
            type="button"
            variant="outline"
            disabled={selectedIds.length === 0 || isBatchPending || Boolean(pendingReview)}
            onClick={() => setBatchAction("approve")}
          >
            <Check className="size-4" />
            批量通过
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={selectedIds.length === 0 || isBatchPending || Boolean(pendingReview)}
            onClick={() => setBatchAction("reject")}
          >
            <X className="size-4" />
            批量拒绝
          </Button>
        </div>
      </div>

      <div className="space-y-3 md:hidden">
        {rows.map((nomination) => {
          const imageUrl = getPublicImageUrl(nomination.image_path);
          const isApproving =
            pendingReview?.id === nomination.id &&
            pendingReview.action === "approve";
          const isRejecting =
            pendingReview?.id === nomination.id &&
            pendingReview.action === "reject";

          return (
            <div
              key={nomination.id}
              className="rounded-2xl border border-[#EED8AA]/70 bg-[#FFFCF4]/85 p-4 shadow-sm"
            >
              <div className="mb-3 flex items-center gap-2">
                <Checkbox
                  checked={selectedSet.has(nomination.id)}
                  disabled={isBatchPending || Boolean(pendingReview)}
                  onCheckedChange={(value) =>
                    toggleSelected(nomination.id, value === true)
                  }
                />
                <span className="text-xs text-muted-foreground">选择</span>
              </div>
              <div className="flex gap-3">
                <div className="size-16 shrink-0 overflow-hidden rounded-xl bg-muted">
                  {imageUrl ? (
                    <img
                      src={imageUrl}
                      alt={`${nomination.name} 图片`}
                      className="size-full object-cover"
                    />
                  ) : (
                    <div className="butter-placeholder flex size-full items-center justify-center">
                      <ImageIcon className="size-5" aria-hidden="true" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="break-words font-semibold leading-snug">
                      {nomination.name}
                    </h3>
                    <Badge variant="secondary">待审核</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    活动：{nomination.contests?.title ?? "未知活动"}
                  </p>
                </div>
              </div>
              <p className="mt-3 break-words text-sm leading-6 text-muted-foreground">
                {nomination.description || "暂无简介。"}
              </p>
              <div className="mt-3 rounded-xl bg-[#FFF8E8]/70 px-3 py-2 text-sm text-muted-foreground">
                提名者：{nomination.nominator_display_name || "未填写"}
              </div>
              <div className="mt-3 rounded-xl bg-white/70 px-3 py-2">
                <div className="mb-1 text-xs font-medium text-muted-foreground">
                  提交用户
                </div>
                <UserIdentity
                  profile={nomination.profiles}
                  fallbackId={nomination.submitter_id}
                />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <LoadingButton
                  type="button"
                  size="sm"
                  className="w-full"
                  disabled={isBatchPending || Boolean(pendingReview)}
                  loading={isApproving}
                  loadingText="保存中..."
                  onClick={() => handleReview(nomination.id, "approve")}
                >
                  <Check className="size-4" />
                  通过
                </LoadingButton>
                <LoadingButton
                  type="button"
                  size="sm"
                  variant="destructive"
                  className="w-full"
                  disabled={isBatchPending || Boolean(pendingReview)}
                  loading={isRejecting}
                  loadingText="保存中..."
                  onClick={() => setSingleRejectTarget(nomination)}
                >
                  <X className="size-4" />
                  拒绝
                </LoadingButton>
              </div>
            </div>
          );
        })}
      </div>
      <div className="hidden rounded-2xl border border-[#EED8AA]/70 md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">
                <Checkbox
                  checked={allSelected}
                  disabled={isBatchPending || Boolean(pendingReview)}
                  onCheckedChange={(value) => toggleAll(value === true)}
                />
              </TableHead>
              <TableHead>图片</TableHead>
              <TableHead>提名</TableHead>
              <TableHead>活动</TableHead>
              <TableHead>简介</TableHead>
              <TableHead>提名者</TableHead>
              <TableHead>提交用户</TableHead>
              <TableHead className="w-[180px] text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((nomination) => {
              const imageUrl = getPublicImageUrl(nomination.image_path);
              const isApproving =
                pendingReview?.id === nomination.id &&
                pendingReview.action === "approve";
              const isRejecting =
                pendingReview?.id === nomination.id &&
                pendingReview.action === "reject";

              return (
                <TableRow key={nomination.id}>
                  <TableCell>
                    <Checkbox
                      checked={selectedSet.has(nomination.id)}
                      disabled={isBatchPending || Boolean(pendingReview)}
                      onCheckedChange={(value) =>
                        toggleSelected(nomination.id, value === true)
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <div className="size-14 overflow-hidden rounded-xl bg-muted">
                      {imageUrl ? (
                        <img
                          src={imageUrl}
                          alt={`${nomination.name} 图片`}
                          className="size-full object-cover"
                        />
                      ) : (
                        <div className="butter-placeholder flex size-full items-center justify-center">
                          <ImageIcon className="size-5" aria-hidden="true" />
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">
                    {nomination.name}
                  </TableCell>
                  <TableCell>
                    {nomination.contests?.title ?? "未知活动"}
                  </TableCell>
                  <TableCell className="max-w-md text-muted-foreground">
                    {nomination.description || "暂无简介。"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {nomination.nominator_display_name || "未填写"}
                  </TableCell>
                  <TableCell>
                    <UserIdentity
                      profile={nomination.profiles}
                      fallbackId={nomination.submitter_id}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap justify-end gap-2">
                      <LoadingButton
                        type="button"
                        size="sm"
                        disabled={isBatchPending || Boolean(pendingReview)}
                        loading={isApproving}
                        loadingText="保存中..."
                        onClick={() => handleReview(nomination.id, "approve")}
                      >
                        <Check className="size-4" />
                        通过
                      </LoadingButton>
                      <LoadingButton
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={isBatchPending || Boolean(pendingReview)}
                        loading={isRejecting}
                        loadingText="保存中..."
                        onClick={() => setSingleRejectTarget(nomination)}
                      >
                        <X className="size-4" />
                        拒绝
                      </LoadingButton>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <Dialog
        open={batchAction !== null}
        onOpenChange={(open) => {
          if (!open && !isBatchPending) {
            setBatchAction(null);
            setBatchRejectReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              确认{batchAction === "approve" ? "批量通过" : "批量拒绝"}？
            </DialogTitle>
            <DialogDescription>
              {batchAction === "approve"
                ? `将通过 ${selectedIds.length} 条提名，并为它们创建候选项。通过后用户即可在对应活动中看到这些候选项。`
                : `将拒绝 ${selectedIds.length} 条提名。拒绝后这些提名不会进入候选项列表，用户需要修改后重新提交。`}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-48 space-y-2 overflow-y-auto rounded-2xl border border-[#EED8AA]/70 bg-[#FFF8E8]/60 p-3 text-sm">
            {rows
              .filter((nomination) => selectedSet.has(nomination.id))
              .map((nomination) => (
                <div key={nomination.id} className="break-words">
                  {nomination.name}
                </div>
              ))}
          </div>
          {batchAction === "reject" ? (
            <div className="space-y-2">
              <label
                htmlFor="batch-rejection-reason"
                className="text-sm font-medium"
              >
                拒绝理由（可选）
              </label>
              <Textarea
                id="batch-rejection-reason"
                value={batchRejectReason}
                onChange={(event) =>
                  setBatchRejectReason(event.currentTarget.value)
                }
                maxLength={500}
                placeholder="例如：图片不清晰、简介信息不足，或与已有提名重复。"
              />
            </div>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={isBatchPending}
              onClick={() => setBatchAction(null)}
            >
              取消
            </Button>
            <LoadingButton
              type="button"
              variant={batchAction === "reject" ? "destructive" : "default"}
              loading={isBatchPending}
              loadingText="处理中..."
              onClick={() =>
                batchAction && handleBatchReview(batchAction, batchRejectReason)
              }
            >
              确认
            </LoadingButton>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={singleRejectTarget !== null}
        onOpenChange={(open) => {
          if (!open && !pendingReview) {
            setSingleRejectTarget(null);
            setSingleRejectReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>拒绝提名</DialogTitle>
            <DialogDescription>
              可以填写拒绝理由，帮助用户修改后重新提交。
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-2xl border border-[#EED8AA]/70 bg-[#FFF8E8]/60 p-3 text-sm">
            {singleRejectTarget?.name}
          </div>
          <div className="space-y-2">
            <label
              htmlFor="single-rejection-reason"
              className="text-sm font-medium"
            >
              拒绝理由（可选）
            </label>
            <Textarea
              id="single-rejection-reason"
              value={singleRejectReason}
              onChange={(event) =>
                setSingleRejectReason(event.currentTarget.value)
              }
              maxLength={500}
              placeholder="例如：图片不清晰、简介信息不足，或与已有提名重复。"
            />
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={Boolean(pendingReview)}
              onClick={() => {
                setSingleRejectTarget(null);
                setSingleRejectReason("");
              }}
            >
              取消
            </Button>
            <LoadingButton
              type="button"
              variant="destructive"
              loading={Boolean(
                pendingReview &&
                  pendingReview.id === singleRejectTarget?.id &&
                  pendingReview.action === "reject",
              )}
              loadingText="保存中..."
              onClick={() => {
                if (singleRejectTarget) {
                  handleReview(
                    singleRejectTarget.id,
                    "reject",
                    singleRejectReason,
                  );
                }
              }}
            >
              确认拒绝
            </LoadingButton>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
