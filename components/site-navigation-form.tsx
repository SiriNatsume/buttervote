"use client";

import Link from "next/link";
import { useState } from "react";
import { updateSiteNavigationAction } from "@/lib/actions/admin-actions";
import type { SiteNavigationValue } from "@/lib/types";
import { getResultsHref } from "@/lib/page-navigation";
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

export function SiteNavigationForm({
  groups,
  contests,
  value,
}: {
  groups: { id: string; label: string }[];
  contests: { id: string; label: string; groupId: string | null }[];
  value: SiteNavigationValue;
}) {
  const [resultsTarget, setResultsTarget] = useState(
    value.resultsGroupId ? `group:${value.resultsGroupId}`
      : value.resultsContestId ? `contest:${value.resultsContestId}` : "none",
  );
  const resultsGroupId = resultsTarget.startsWith("group:") ? resultsTarget.slice(6) : null;
  const resultsContestId = resultsTarget.startsWith("contest:") ? resultsTarget.slice(8) : null;
  const resultsAvailable = resultsTarget === "none" || (resultsGroupId
    ? groups.some((group) => group.id === resultsGroupId)
    : contests.some((contest) => contest.id === resultsContestId && !contest.groupId));
  const resultsHref = getResultsHref({ resultsGroupId, resultsContestId, nominationContestId: null });
  const [nominationContestId, setNominationContestId] = useState(
    value.nominationContestId ?? "none",
  );
  const contestAvailable = contests.some((contest) => contest.id === nominationContestId);

  return (
    <TransitionActionForm
      action={updateSiteNavigationAction}
      successMessage="投票与提名入口已保存"
    >
      <FormStatusFieldset className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="results-target">“赛程结果”默认打开的活动或活动组</Label>
          <input type="hidden" name="resultsGroupId" value={resultsGroupId ?? "none"} />
          <input type="hidden" name="resultsContestId" value={resultsContestId ?? "none"} />
          <Select
            value={resultsTarget}
            onValueChange={setResultsTarget}
          >
            <SelectTrigger id="results-target" aria-describedby="results-target-help">
              <SelectValue placeholder="选择活动或活动组" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">不设置默认入口</SelectItem>
              {!resultsAvailable ? (
                <SelectItem value={resultsTarget} disabled>
                  当前入口不可用，请重新选择
                </SelectItem>
              ) : null}
              {groups.map((group) => (
                <SelectItem key={group.id} value={`group:${group.id}`}>
                  活动组 · {group.label}
                </SelectItem>
              ))}
              {contests.filter((contest) => !contest.groupId).map((contest) => (
                <SelectItem key={contest.id} value={`contest:${contest.id}`}>
                  独立活动 · {contest.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p id="results-target-help" className="text-sm text-muted-foreground">
            顶部和底部导航打开所选入口，其子页面均归属“赛程结果”。切换默认入口后，之前收录的内容仍保留栏目归属。
            组内活动请选所属活动组作为入口。
          </p>
          <p className="text-sm text-muted-foreground">
            首页“我的投票”前往所选活动的投票页，或所选活动组的联合投票页。
          </p>
          {resultsAvailable && resultsHref ? (
            <Link
              href={resultsHref}
              className="inline-block text-sm text-primary underline-offset-4 hover:underline"
            >
              查看赛程入口页面
            </Link>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="nomination-contest-id">“前往提名”前往的活动</Label>
          <Select
            name="nominationContestId"
            value={nominationContestId}
            onValueChange={setNominationContestId}
          >
            <SelectTrigger id="nomination-contest-id" aria-describedby="nomination-contest-help">
              <SelectValue placeholder="选择提名活动" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">暂不开放</SelectItem>
              {nominationContestId !== "none" && !contestAvailable ? (
                <SelectItem value={nominationContestId} disabled>
                  当前活动不可用，请重新选择
                </SelectItem>
              ) : null}
              {contests.map((contest) => (
                <SelectItem key={contest.id} value={contest.id}>
                  {contest.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p id="nomination-contest-help" className="text-sm text-muted-foreground">
            首页“前往提名”直接打开所选活动的提名页面；请确认活动已开放提名。
          </p>
          {contestAvailable ? (
            <Link
              href={`/contests/${nominationContestId}/nominate`}
              className="inline-block text-sm text-primary underline-offset-4 hover:underline"
            >
              查看提名页面
            </Link>
          ) : null}
        </div>
        <FormSubmitButton
          className="w-full sm:w-auto"
          loadingText="保存中..."
          disabled={!resultsAvailable || (nominationContestId !== "none" && !contestAvailable)}
        >
          保存投票与提名入口
        </FormSubmitButton>
      </FormStatusFieldset>
    </TransitionActionForm>
  );
}
