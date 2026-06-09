"use client";

import { useState } from "react";
import { updateHomepageBracketAction } from "@/lib/actions/admin-actions";
import type { HomepageBracketValue } from "@/lib/types";
import { FormStatusFieldset } from "@/components/form-status-fieldset";
import { FormSubmitButton } from "@/components/form-submit-button";
import { TransitionActionForm } from "@/components/transition-action-form";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Option = {
  id: string;
  label: string;
};

export function HomepageBracketForm({
  tournaments,
  value,
}: {
  tournaments: Option[];
  value?: HomepageBracketValue | null;
}) {
  const initialTournamentId =
    value?.tournamentId &&
    tournaments.some((tournament) => tournament.id === value.tournamentId)
      ? value.tournamentId
      : "none";
  const [tournamentId, setTournamentId] = useState(initialTournamentId);

  return (
    <TransitionActionForm
      action={updateHomepageBracketAction}
      successMessage="首页对阵图已保存"
    >
      <FormStatusFieldset className="space-y-5">
        <div className="space-y-2">
          <Label>首页对阵图</Label>
          <Select
            name="tournamentId"
            value={tournamentId}
            onValueChange={setTournamentId}
          >
            <SelectTrigger>
              <SelectValue placeholder="选择赛事" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">不展示对阵图</SelectItem>
              {tournaments.map((tournament) => (
                <SelectItem key={tournament.id} value={tournament.id}>
                  {tournament.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <FormSubmitButton className="w-full sm:w-auto" loadingText="保存中...">
          保存首页对阵图
        </FormSubmitButton>
      </FormStatusFieldset>
    </TransitionActionForm>
  );
}
