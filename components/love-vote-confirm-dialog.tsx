"use client";

import { LoadingButton } from "@/components/loading-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type LoveVoteSupplementReviewChoice = { id: string; contestTitle: string; name: string };

export function LoveVoteConfirmDialog({
  open,
  candidateNames = [],
  supplementChoices,
  confirmDisabled = false,
  loading,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  candidateNames?: string[];
  supplementChoices?: LoveVoteSupplementReviewChoice[];
  confirmDisabled?: boolean;
  loading?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const isSupplement = supplementChoices !== undefined;
  const count = supplementChoices?.length ?? candidateNames.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isSupplement ? "核对补投名单" : "确认使用真爱票？"}</DialogTitle>
          <DialogDescription>
            {isSupplement
              ? "提交后，真爱票不可撤回。"
              : `真爱票额度有限，本次将使用 ${count} 张。投票提交后不可修改，也不能撤回真爱票。`}
          </DialogDescription>
        </DialogHeader>
        {isSupplement ? (
          <ul className="space-y-2 text-sm">
            {supplementChoices.map((choice) => (
              <li key={choice.id} className="break-words rounded-xl border border-[#EED8AA]/70 bg-white/60 px-3 py-2">
                <div className="text-xs text-muted-foreground">{choice.contestTitle}</div>
                <div className="font-semibold">{choice.name}</div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="space-y-3 rounded-2xl border border-[#EED8AA]/70 bg-[#FFF8E8]/60 p-4">
            <div className="text-sm font-medium">你将把真爱票投给以下选项：</div>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {candidateNames.map((name, index) => (
                <li key={`${index}-${name}`} className="break-words">- {name}</li>
              ))}
            </ul>
          </div>
        )}
        {confirmDisabled ? <p role="alert" className="text-sm text-destructive">可补投名单或额度已更新，请返回重新核对。</p> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={() => onOpenChange(false)}
          >
            {isSupplement ? "返回修改" : "取消"}
          </Button>
          <LoadingButton
            type="button"
            variant={isSupplement ? "love" : "loveParticipation"}
            loading={Boolean(loading)}
            disabled={confirmDisabled}
            loadingText="提交中..."
            onClick={onConfirm}
            className={isSupplement ? "min-h-11 rounded-xl border-[#A7304D] bg-[#A7304D] hover:bg-[#902340]" : undefined}
          >
            {isSupplement ? `确认补投 ${count} 张` : "确认提交"}
          </LoadingButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}
