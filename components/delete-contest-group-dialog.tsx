"use client";

import { Trash2 } from "lucide-react";
import { deleteContestGroupAction } from "@/lib/actions/admin-actions";
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

export function DeleteContestGroupDialog({
  groupId,
  triggerLabel = "删除活动组",
  triggerClassName,
}: {
  groupId: string;
  triggerLabel?: string;
  triggerClassName?: string;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm" className={triggerClassName}>
          <Trash2 className="size-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>确认删除活动组？</DialogTitle>
          <DialogDescription>
            删除活动组不会删除组内活动，组内活动将自动变为未分组。该操作不可撤销。
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              取消
            </Button>
          </DialogClose>
          <TransitionActionForm
            action={deleteContestGroupAction}
            successMessage="活动组已删除"
          >
            <input type="hidden" name="groupId" value={groupId} />
            <FormSubmitButton
              variant="destructive"
              className="w-full sm:w-auto"
              loadingText="删除中..."
            >
              删除活动组
            </FormSubmitButton>
          </TransitionActionForm>
        </div>
      </DialogContent>
    </Dialog>
  );
}
