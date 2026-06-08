"use client";

import { Shuffle, Trophy } from "lucide-react";
import {
  createTournamentAction,
  generatePreliminaryStageAction,
} from "@/lib/actions/tournament-actions";
import type { Contest, ContestGroup } from "@/lib/types";
import { FormStatusFieldset } from "@/components/form-status-fieldset";
import { FormSubmitButton } from "@/components/form-submit-button";
import { TransitionActionForm } from "@/components/transition-action-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
