"use client";

import { Trash2 } from "lucide-react";
import { softDeleteCandidateByAdmin } from "@/lib/actions/admin-actions";
import { FormSubmitButton } from "@/components/form-submit-button";
import { TransitionActionForm } from "@/components/transition-action-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function DeleteCandidateDialog({
  candidateId,
  candidateName,
  hasVotes,
}: {
  candidateId: string;
  candidateName: string;
  hasVotes: boolean;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="destructive" className="w-full">
          <Trash2 className="size-4" />
          删除
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>确认删除候选项？</DialogTitle>
          <DialogDescription>
            将从当前活动中隐藏「{candidateName}」，用户无法继续投给该候选项。
            {hasVotes
              ? "该候选项已有历史投票，删除后会保留历史数据和结果统计。"
              : "该操作会软删除候选项，后续可在已删除列表中恢复。"}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              取消
            </Button>
          </DialogClose>
          <TransitionActionForm
            action={softDeleteCandidateByAdmin}
            successMessage="候选项已删除"
          >
            <input type="hidden" name="candidateId" value={candidateId} />
            <FormSubmitButton
              variant="destructive"
              className="w-full sm:w-auto"
              loadingText="删除中..."
            >
              确认删除
            </FormSubmitButton>
          </TransitionActionForm>
        </div>
      </DialogContent>
    </Dialog>
  );
}
