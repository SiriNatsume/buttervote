"use client";

import { Trash2 } from "lucide-react";
import { deleteUserGroup } from "@/lib/actions/user-group-actions";
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

export function DeleteUserGroupDialog({
  userGroupId,
  triggerLabel = "删除用户组",
  triggerClassName,
}: {
  userGroupId: string;
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
          <DialogTitle>确认删除用户组？</DialogTitle>
          <DialogDescription>
            删除用户组会级联删除成员关系和活动组允许关系，但不会删除用户资料。该操作不可撤销。
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              取消
            </Button>
          </DialogClose>
          <TransitionActionForm
            action={deleteUserGroup}
            successMessage="用户组已删除"
          >
            <input type="hidden" name="userGroupId" value={userGroupId} />
            <FormSubmitButton
              variant="destructive"
              className="w-full sm:w-auto"
              loadingText="删除中..."
            >
              删除用户组
            </FormSubmitButton>
          </TransitionActionForm>
        </div>
      </DialogContent>
    </Dialog>
  );
}
