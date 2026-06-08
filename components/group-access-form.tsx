"use client";

import { useState } from "react";
import { ShieldCheck, UsersRound } from "lucide-react";
import { updateContestGroupAccess } from "@/lib/actions/user-group-actions";
import { FormStatusFieldset } from "@/components/form-status-fieldset";
import { FormSubmitButton } from "@/components/form-submit-button";
import { TransitionActionForm } from "@/components/transition-action-form";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import type { ContestGroupAccessMode, UserGroup } from "@/lib/types";

export function GroupAccessForm({
  groupId,
  accessMode,
  userGroups,
  allowedUserGroupIds,
}: {
  groupId: string;
  accessMode: ContestGroupAccessMode;
  userGroups: Array<Pick<UserGroup, "id" | "name" | "description" | "join_code">>;
  allowedUserGroupIds: string[];
}) {
  const [mode, setMode] = useState<ContestGroupAccessMode>(accessMode);
  const [selectedIds, setSelectedIds] = useState(new Set(allowedUserGroupIds));

  function toggleUserGroup(userGroupId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(userGroupId)) {
        next.delete(userGroupId);
      } else {
        next.add(userGroupId);
      }
      return next;
    });
  }

  return (
    <TransitionActionForm
      action={updateContestGroupAccess}
      successMessage="参与权限已保存"
    >
      <FormStatusFieldset className="space-y-5">
        <input type="hidden" name="groupId" value={groupId} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Label className="flex cursor-pointer gap-3 rounded-2xl border border-[#EED8AA]/70 bg-[#FFFCF4]/80 p-4 shadow-sm">
            <input
              type="radio"
              name="accessMode"
              value="public"
              checked={mode === "public"}
              onChange={() => setMode("public")}
              className="mt-1 size-4 accent-[#E88D35]"
            />
            <span className="min-w-0">
              <span className="flex items-center gap-2 font-medium">
                <UsersRound className="size-4 text-[#C75F1A]" />
                公开
              </span>
              <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                所有登录用户可参与投票。
              </span>
            </span>
          </Label>

          <Label className="flex cursor-pointer gap-3 rounded-2xl border border-[#EED8AA]/70 bg-[#FFFCF4]/80 p-4 shadow-sm">
            <input
              type="radio"
              name="accessMode"
              value="restricted"
              checked={mode === "restricted"}
              onChange={() => setMode("restricted")}
              className="mt-1 size-4 accent-[#E88D35]"
            />
            <span className="min-w-0">
              <span className="flex items-center gap-2 font-medium">
                <ShieldCheck className="size-4 text-[#C75F1A]" />
                限制
              </span>
              <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                仅指定用户组的有效成员可参与投票。
              </span>
            </span>
          </Label>
        </div>

        {mode === "restricted" ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Label>允许参与的用户组</Label>
              <Badge variant="secondary">{selectedIds.size} 个已选择</Badge>
            </div>

            {userGroups.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {userGroups.map((userGroup) => {
                  const checked = selectedIds.has(userGroup.id);

                  return (
                    <Label
                      key={userGroup.id}
                      className="flex cursor-pointer gap-3 rounded-2xl border border-[#EED8AA]/70 bg-white/60 p-4"
                    >
                      <input
                        type="checkbox"
                        name="allowedUserGroupIds"
                        value={userGroup.id}
                        checked={checked}
                        onChange={() => toggleUserGroup(userGroup.id)}
                        className="mt-1 size-4 accent-[#E88D35]"
                      />
                      <span className="min-w-0">
                        <span className="block break-words font-medium">
                          {userGroup.name}
                        </span>
                        <span className="mt-1 block break-words text-xs text-muted-foreground">
                          {userGroup.join_code || "未设置入组代码"}
                        </span>
                        {userGroup.description ? (
                          <span className="mt-2 line-clamp-2 block text-sm leading-6 text-muted-foreground">
                            {userGroup.description}
                          </span>
                        ) : null}
                      </span>
                    </Label>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl border border-[#EED8AA]/70 bg-white/60 p-5 text-sm text-muted-foreground">
                暂无用户组，请先在后台创建用户组。
              </div>
            )}

            {selectedIds.size === 0 ? (
              <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                当前未选择用户组，普通用户将无法参与该活动组。
              </div>
            ) : null}
          </div>
        ) : null}

        <FormSubmitButton className="w-full sm:w-auto" loadingText="保存中...">
          保存参与权限
        </FormSubmitButton>
      </FormStatusFieldset>
    </TransitionActionForm>
  );
}
