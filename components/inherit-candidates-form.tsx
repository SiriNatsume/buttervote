"use client";

import { useMemo, useState } from "react";
import { CopyPlus } from "lucide-react";
import { inheritCandidatesAction } from "@/lib/actions/admin-actions";
import type { Candidate, Contest } from "@/lib/types";
import { FormStatusFieldset } from "@/components/form-status-fieldset";
import { FormSubmitButton } from "@/components/form-submit-button";
import { TransitionActionForm } from "@/components/transition-action-form";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ContestOption = Pick<Contest, "id" | "title">;
type CandidateOption = Pick<Candidate, "id" | "contest_id" | "name" | "description">;

export function InheritCandidatesForm({
  contests,
  candidates,
  defaultTargetContestId,
  returnTo,
}: {
  contests: ContestOption[];
  candidates: CandidateOption[];
  defaultTargetContestId?: string;
  returnTo: string;
}) {
  const [targetContestId, setTargetContestId] = useState(
    defaultTargetContestId ?? contests[0]?.id ?? "",
  );
  const [sourceContestId, setSourceContestId] = useState("");
  const sourceCandidates = useMemo(
    () =>
      candidates.filter((candidate) => candidate.contest_id === sourceContestId),
    [candidates, sourceContestId],
  );
  const sourceContests = contests.filter(
    (contest) => contest.id !== targetContestId,
  );

  return (
    <TransitionActionForm
      action={inheritCandidatesAction}
      successMessage="候选项已继承"
    >
      <FormStatusFieldset className="space-y-5">
        <input type="hidden" name="returnTo" value={returnTo} />
        <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>目标活动</Label>
          <Select
            name="targetContestId"
            value={targetContestId}
            onValueChange={(value) => {
              setTargetContestId(value);
              if (value === sourceContestId) {
                setSourceContestId("");
              }
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="选择目标活动" />
            </SelectTrigger>
            <SelectContent>
              {contests.map((contest) => (
                <SelectItem key={contest.id} value={contest.id}>
                  {contest.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>来源活动</Label>
          <Select
            name="sourceContestId"
            value={sourceContestId}
            onValueChange={setSourceContestId}
          >
            <SelectTrigger>
              <SelectValue placeholder="选择来源活动" />
            </SelectTrigger>
            <SelectContent>
              {sourceContests.map((contest) => (
                <SelectItem key={contest.id} value={contest.id}>
                  {contest.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {sourceContestId ? (
        sourceCandidates.length > 0 ? (
          <div className="space-y-3 rounded-2xl border p-4">
            {sourceCandidates.map((candidate) => (
              <Label
                key={candidate.id}
                className="flex cursor-pointer items-start gap-3 rounded-xl border p-3"
              >
                <Checkbox name="candidateIds" value={candidate.id} />
                <span className="min-w-0">
                  <span className="block font-medium">{candidate.name}</span>
                  {candidate.description ? (
                    <span className="mt-1 block text-sm font-normal leading-5 text-muted-foreground">
                      {candidate.description}
                    </span>
                  ) : null}
                </span>
              </Label>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border p-4 text-sm text-muted-foreground">
            选中的来源活动暂无候选项。
          </div>
        )
      ) : null}

        <FormSubmitButton
          disabled={!targetContestId || !sourceContestId || sourceCandidates.length === 0}
          loadingText="保存中..."
        >
          <CopyPlus className="size-4" />
          继承选中的候选项
        </FormSubmitButton>
      </FormStatusFieldset>
    </TransitionActionForm>
  );
}
