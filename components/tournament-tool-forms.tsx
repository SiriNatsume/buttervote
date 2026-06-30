"use client";

import { useState } from "react";
import { RotateCcw, Shuffle, Trophy } from "lucide-react";
import {
  createTournamentAction,
  generateKnockoutStageAction,
  generateNextKnockoutRoundAction,
  generatePreliminaryStageAction,
  generatePreliminaryTiebreakersAction,
  retractTournamentDrawAction,
} from "@/lib/actions/tournament-actions";
import type { Contest, ContestGroup } from "@/lib/types";
import { FormStatusFieldset } from "@/components/form-status-fieldset";
import { FormSubmitButton } from "@/components/form-submit-button";
import { TransitionActionForm } from "@/components/transition-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type TournamentFormAction = (
  formData: FormData,
) => Promise<
  | {
      ok?: boolean;
      error?: string;
      message?: string;
      redirectTo?: string;
      refresh?: boolean;
    }
  | void
>;

export function CreateTournamentForm({
  contests,
}: {
  contests: Array<Pick<Contest, "id" | "title" | "status">>;
}) {
  return (
    <TransitionActionForm
      action={createTournamentAction}
      successMessage="赛事已创建"
      refresh={false}
      className="space-y-4"
    >
      <FormStatusFieldset className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="tournament-name">赛事名称</Label>
          <Input
            id="tournament-name"
            name="name"
            required
            maxLength={160}
            placeholder="Butter Vote 年度赛"
          />
        </div>
        <div className="space-y-2">
          <Label>海选活动</Label>
          <Select name="screeningContestId" disabled={contests.length === 0}>
            <SelectTrigger>
              <SelectValue placeholder="选择一个多选海选活动" />
            </SelectTrigger>
            <SelectContent>
              {contests.map((contest) => (
                <SelectItem key={contest.id} value={contest.id}>
                  {contest.title}（{contest.status}）
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <FormSubmitButton
          className="w-full sm:w-auto"
          disabled={contests.length === 0}
          loadingText="创建中..."
        >
          <Trophy className="size-4" />
          创建赛事
        </FormSubmitButton>
      </FormStatusFieldset>
    </TransitionActionForm>
  );
}

export function GeneratePreliminaryForm({
  tournamentId,
  groups,
  disabled = false,
}: {
  tournamentId: string;
  groups: Array<Pick<ContestGroup, "id" | "name">>;
  disabled?: boolean;
}) {
  return (
    <TransitionActionForm
      action={generatePreliminaryStageAction}
      successMessage="预赛已生成"
      className="space-y-4"
    >
      <FormStatusFieldset className="space-y-4">
        <input type="hidden" name="tournamentId" value={tournamentId} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>放入活动组</Label>
            <Select name="targetGroupId" defaultValue="none" disabled={disabled}>
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
          <div className="space-y-2">
            <Label htmlFor={`seed-${tournamentId}`}>抽签 seed</Label>
            <Input
              id={`seed-${tournamentId}`}
              name="seed"
              maxLength={160}
              placeholder="留空则自动生成"
              disabled={disabled}
            />
          </div>
        </div>
        <FormSubmitButton
          className="w-full sm:w-auto"
          disabled={disabled}
          loadingText="生成中..."
        >
          <Shuffle className="size-4" />
          生成预赛 A/B/C/D
        </FormSubmitButton>
      </FormStatusFieldset>
    </TransitionActionForm>
  );
}

function FollowupStageForm({
  tournamentId,
  groups,
  disabled,
  action,
  title,
  buttonLabel,
  seedId,
  seedPlaceholder,
}: {
  tournamentId: string;
  groups: Array<Pick<ContestGroup, "id" | "name">>;
  disabled?: boolean;
  action: TournamentFormAction;
  title: string;
  buttonLabel: string;
  seedId: string;
  seedPlaceholder: string;
}) {
  return (
    <TransitionActionForm action={action} successMessage={title} className="space-y-4">
      <FormStatusFieldset className="space-y-4">
        <input type="hidden" name="tournamentId" value={tournamentId} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>放入活动组</Label>
            <Select name="targetGroupId" defaultValue="none" disabled={disabled}>
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
          <div className="space-y-2">
            <Label htmlFor={seedId}>seed</Label>
            <Input
              id={seedId}
              name="seed"
              maxLength={160}
              placeholder={seedPlaceholder}
              disabled={disabled}
            />
          </div>
        </div>
        <FormSubmitButton
          className="w-full sm:w-auto"
          disabled={disabled}
          loadingText="生成中..."
        >
          <Shuffle className="size-4" />
          {buttonLabel}
        </FormSubmitButton>
      </FormStatusFieldset>
    </TransitionActionForm>
  );
}

export function GenerateTiebreakersForm({
  tournamentId,
  groups,
  disabled = false,
}: {
  tournamentId: string;
  groups: Array<Pick<ContestGroup, "id" | "name">>;
  disabled?: boolean;
}) {
  return (
    <FollowupStageForm
      tournamentId={tournamentId}
      groups={groups}
      disabled={disabled}
      action={generatePreliminaryTiebreakersAction}
      title="加赛已生成"
      buttonLabel="生成预赛加赛"
      seedId={`tiebreaker-seed-${tournamentId}`}
      seedPlaceholder="留空则自动生成"
    />
  );
}

export function GenerateKnockoutForm({
  tournamentId,
  groups,
  disabled = false,
}: {
  tournamentId: string;
  groups: Array<Pick<ContestGroup, "id" | "name">>;
  disabled?: boolean;
}) {
  return (
    <FollowupStageForm
      tournamentId={tournamentId}
      groups={groups}
      disabled={disabled}
      action={generateKnockoutStageAction}
      title="正赛已生成"
      buttonLabel="生成正赛 16 强"
      seedId={`knockout-seed-${tournamentId}`}
      seedPlaceholder="留空则自动生成"
    />
  );
}

export function GenerateNextKnockoutRoundForm({
  tournamentId,
  groups,
  disabled = false,
}: {
  tournamentId: string;
  groups: Array<Pick<ContestGroup, "id" | "name">>;
  disabled?: boolean;
}) {
  return (
    <FollowupStageForm
      tournamentId={tournamentId}
      groups={groups}
      disabled={disabled}
      action={generateNextKnockoutRoundAction}
      title="下一轮正赛已生成"
      buttonLabel="生成下一轮正赛"
      seedId={`next-knockout-seed-${tournamentId}`}
      seedPlaceholder="留空则自动生成"
    />
  );
}

export function RetractTournamentDrawDialog({
  tournamentId,
  drawLogId,
  drawTitle,
}: {
  tournamentId: string;
  drawLogId: string;
  drawTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const reasonId = `retract-reason-${drawLogId}`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="destructive" size="sm">
          <RotateCcw className="size-4" />
          撤回抽签
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>撤回抽签？</DialogTitle>
          <DialogDescription>
            将撤回“{drawTitle}”，并归档这次抽签生成且仍处于草稿状态的比赛。此操作会保留透明度记录。
          </DialogDescription>
        </DialogHeader>
        <TransitionActionForm
          action={retractTournamentDrawAction}
          successMessage="抽签已撤回"
          onSuccess={() => setOpen(false)}
          className="space-y-4"
        >
          <input type="hidden" name="tournamentId" value={tournamentId} />
          <input type="hidden" name="drawLogId" value={drawLogId} />
          <div className="space-y-2">
            <Label htmlFor={reasonId}>撤回理由</Label>
            <Textarea
              id={reasonId}
              name="reason"
              required
              maxLength={500}
              placeholder="例如：抽签前发现预赛结果录入有误，需要修正后重新生成。"
            />
          </div>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                取消
              </Button>
            </DialogClose>
            <FormSubmitButton
              variant="destructive"
              className="w-full sm:w-auto"
              loadingText="撤回中..."
            >
              确认撤回
            </FormSubmitButton>
          </div>
        </TransitionActionForm>
      </DialogContent>
    </Dialog>
  );
}
