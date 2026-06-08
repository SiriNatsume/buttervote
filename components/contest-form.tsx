"use client";

import { Plus } from "lucide-react";
import { createContestAction } from "@/lib/actions/admin-actions";
import type { ContestGroup } from "@/lib/types";
import { FormStatusFieldset } from "@/components/form-status-fieldset";
import { FormSubmitButton } from "@/components/form-submit-button";
import { TransitionActionForm } from "@/components/transition-action-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export function ContestForm({
  groups = [],
  defaultGroupId,
  triggerLabel = "创建活动",
  triggerClassName,
}: {
  groups?: Array<Pick<ContestGroup, "id" | "name">>;
  defaultGroupId?: string | null;
  triggerLabel?: string;
  triggerClassName?: string;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className={triggerClassName ?? "w-full sm:w-auto"}>
          <Plus className="size-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>创建活动</DialogTitle>
          <DialogDescription>
            先创建活动，再补充封面、候选项和运营设置。
          </DialogDescription>
        </DialogHeader>
        <TransitionActionForm
          action={createContestAction}
          refresh={false}
          successMessage="活动已创建"
        >
          <FormStatusFieldset className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">标题</Label>
              <Input id="title" name="title" required placeholder="年度最佳作品" />
            </div>
          <div className="space-y-2">
            <Label htmlFor="description">简介</Label>
            <Textarea
              id="description"
              name="description"
              placeholder="简单介绍这个活动。"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>状态</Label>
              <Select name="status" defaultValue="draft">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">草稿</SelectItem>
                  <SelectItem value="nominating">提名中</SelectItem>
                  <SelectItem value="admin_nominating">管理员提名</SelectItem>
                  <SelectItem value="waiting">等待开始</SelectItem>
                  <SelectItem value="voting">投票中</SelectItem>
                  <SelectItem value="closed">已结束</SelectItem>
                  <SelectItem value="published">已发布</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>投票类型</Label>
              <Select name="vote_type" defaultValue="single">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">单选</SelectItem>
                  <SelectItem value="multiple">多选</SelectItem>
                  <SelectItem value="ranked">排名投票</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="max_choices">最多可选</Label>
              <Input
                id="max_choices"
                name="max_choices"
                type="number"
                min={1}
                defaultValue={1}
                required
              />
            </div>
            <Label className="flex items-center gap-3 rounded-2xl border border-[#EED8AA]/70 bg-[#FFF8E8]/60 p-4">
              <Checkbox name="require_exact_choices" />
              <span>
                多选必须选满
                <span className="block text-xs leading-5 text-muted-foreground">
                  仅多选投票生效，勾选后必须选择上方数量。
                </span>
              </span>
            </Label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>活动组</Label>
              <Select name="group_id" defaultValue={defaultGroupId ?? "none"}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不属于活动组</SelectItem>
                  {groups.map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      {group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-3 rounded-2xl border border-[#EED8AA]/70 bg-[#FFF8E8]/60 p-4 sm:grid-cols-2">
            <Label className="flex items-center gap-3">
              <Checkbox name="show_candidate_image" defaultChecked />
              展示候选项图片
            </Label>
            <Label className="flex items-center gap-3">
              <Checkbox name="show_candidate_description" defaultChecked />
              展示候选项简介
            </Label>
            <Label className="flex items-center gap-3 sm:col-span-2">
              <Checkbox name="nomination_image_required" />
              <span>
                提名必须上传图片
                <span className="block text-xs leading-5 text-muted-foreground">
                  勾选后，用户上传图片后才会进入待审核。
                </span>
              </span>
            </Label>
          </div>
            <FormSubmitButton className="w-full" loadingText="保存中...">
              创建
            </FormSubmitButton>
          </FormStatusFieldset>
        </TransitionActionForm>
      </DialogContent>
    </Dialog>
  );
}
