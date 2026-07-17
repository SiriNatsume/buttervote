"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { FormSubmitButton } from "@/components/form-submit-button";
import { TransitionActionForm } from "@/components/transition-action-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  setGroupRelatedPagesAction,
  updateGroupHomepageSettingsAction,
} from "@/lib/actions/group-homepage-actions";

type Option = { id: string; label: string };

export function GroupHomepageAdminSettings({
  groupId,
  showBracket,
  featuredTournamentId,
  tournaments,
  pages,
  initialPageIds,
}: {
  groupId: string;
  showBracket: boolean;
  featuredTournamentId: string | null;
  tournaments: Option[];
  pages: Option[];
  initialPageIds: string[];
}) {
  const router = useRouter();
  const [pageIds, setPageIds] = useState(initialPageIds);
  const [pageToAdd, setPageToAdd] = useState("");
  const [savingPages, startSavingPages] = useTransition();
  const pageById = useMemo(() => new Map(pages.map((page) => [page.id, page])), [pages]);
  const availablePages = pages.filter((page) => !pageIds.includes(page.id));

  function move(index: number, offset: -1 | 1) {
    const target = index + offset;
    if (target < 0 || target >= pageIds.length) return;
    setPageIds((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function savePages() {
    startSavingPages(async () => {
      const result = await setGroupRelatedPagesAction({ groupId, pageIds });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      router.refresh();
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4 rounded-xl border border-[#EED8AA]/70 p-4">
        <div>
          <h3 className="font-semibold">对阵图区域</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            启用后，活动组首页会保留对阵图区域；未选择或尚未生成时显示空状态。
          </p>
        </div>
        <TransitionActionForm
          action={updateGroupHomepageSettingsAction}
          successMessage="活动组首页设置已保存"
          className="space-y-4"
        >
          <input type="hidden" name="groupId" value={groupId} />
          <label className="flex items-center gap-3 text-sm font-medium">
            <Checkbox name="showBracket" defaultChecked={showBracket} />
            在首页显示对阵图区域
          </label>
          <div className="space-y-2">
            <Label htmlFor="featuredTournamentId">首页赛事</Label>
            <select
              id="featuredTournamentId"
              name="featuredTournamentId"
              defaultValue={featuredTournamentId ?? "none"}
              className="flex h-10 w-full rounded-xl border border-input bg-[#FFFCF4]/80 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="none">暂不指定</option>
              {tournaments.map((tournament) => (
                <option key={tournament.id} value={tournament.id}>
                  {tournament.label}
                </option>
              ))}
            </select>
          </div>
          <FormSubmitButton loadingText="保存中...">保存对阵图设置</FormSubmitButton>
        </TransitionActionForm>
      </div>

      <div className="space-y-4 rounded-xl border border-[#EED8AA]/70 p-4">
        <div>
          <h3 className="font-semibold">关联页面</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            只能关联所有人可见的页面。页面将按此处顺序显示。
          </p>
        </div>
        <div className="flex gap-2">
          <select
            value={pageToAdd}
            onChange={(event) => setPageToAdd(event.target.value)}
            className="h-10 min-w-0 flex-1 rounded-xl border border-input bg-[#FFFCF4]/80 px-3 text-sm"
          >
            <option value="">选择页面</option>
            {availablePages.map((page) => (
              <option key={page.id} value={page.id}>{page.label}</option>
            ))}
          </select>
          <Button
            type="button"
            variant="outline"
            disabled={!pageToAdd}
            onClick={() => {
              if (!pageToAdd) return;
              setPageIds((current) => [...current, pageToAdd]);
              setPageToAdd("");
            }}
          >
            <Plus className="size-4" />添加
          </Button>
        </div>
        {pageIds.length > 0 ? (
          <div className="space-y-2">
            {pageIds.map((pageId, index) => (
              <div
                key={pageId}
                className="flex items-center gap-2 rounded-xl border border-[#EED8AA]/70 bg-white/60 px-3 py-2"
              >
                <span className="min-w-0 flex-1 break-words text-sm font-medium">
                  {pageById.get(pageId)?.label ?? "页面已不可用"}
                </span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="上移"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp className="size-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="下移"
                  disabled={index === pageIds.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown className="size-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="移除"
                  onClick={() =>
                    setPageIds((current) => current.filter((id) => id !== pageId))
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            尚未关联页面。
          </p>
        )}
        <Button type="button" onClick={savePages} disabled={savingPages}>
          {savingPages ? "保存中..." : "保存关联页面"}
        </Button>
      </div>
    </div>
  );
}
