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

export function LoveVoteConfirmDialog({
  open,
  candidateNames,
  loading,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  candidateNames: string[];
  loading?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>确认使用真爱票？</DialogTitle>
          <DialogDescription>
            真爱票额度有限，本次将使用 {candidateNames.length} 张。投票提交后不可修改，也不能撤回真爱票。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 rounded-2xl border border-[#EED8AA]/70 bg-[#FFF8E8]/60 p-4">
          <div className="text-sm font-medium">你将把真爱票投给以下选项：</div>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {candidateNames.map((name) => (
              <li key={name} className="break-words">
                - {name}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <LoadingButton
            type="button"
            variant="love"
            loading={Boolean(loading)}
            loadingText="提交中..."
            onClick={onConfirm}
          >
            确认提交
          </LoadingButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}
