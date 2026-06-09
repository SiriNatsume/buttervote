"use client";

import { Archive } from "lucide-react";
import { archiveContestAction } from "@/lib/actions/admin-actions";
import { FormSubmitButton } from "@/components/form-submit-button";
import { TransitionActionForm } from "@/components/transition-action-form";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function ArchiveContestDialog({
  contestId,
  contestTitle,
  triggerClassName,
  triggerSize,
}: {
  contestId: string;
  contestTitle: string;
  triggerClassName?: string;
  triggerSize?: ButtonProps["size"];
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="destructive"
          size={triggerSize}
          className={triggerClassName}
        >
          <Archive className="size-4" />
          归档活动
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>确认归档活动？</DialogTitle>
          <DialogDescription>
            归档后「{contestTitle}」会从公开页面、活动组列表和赛制工具中隐藏，
            未执行的定时状态会被删除，历史投票和候选数据仍会保留。
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              取消
            </Button>
          </DialogClose>
          <TransitionActionForm
            action={archiveContestAction}
            successMessage="活动已归档"
          >
            <input type="hidden" name="contestId" value={contestId} />
            <FormSubmitButton
              variant="destructive"
              className="w-full sm:w-auto"
              loadingText="归档中..."
            >
              确认归档
            </FormSubmitButton>
          </TransitionActionForm>
        </div>
      </DialogContent>
    </Dialog>
  );
}
