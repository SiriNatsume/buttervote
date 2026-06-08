"use client";

import { useMemo, useState } from "react";
import { AlertCircle, Search } from "lucide-react";
import { createNominationAction } from "@/lib/actions/nomination-actions";
import { formatDateTime } from "@/lib/time";
import type { ExistingNomination } from "@/components/existing-nominations-list";
import { DescriptionTextarea } from "@/components/description-textarea";
import { FormStatusFieldset } from "@/components/form-status-fieldset";
import { FormSubmitButton } from "@/components/form-submit-button";
import { TransitionActionForm } from "@/components/transition-action-form";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const nominationStatusLabel: Record<ExistingNomination["status"], string> = {
  draft: "待上传图片",
  pending: "待审核",
  approved: "已通过",
  rejected: "已拒绝",
};

function normalizeSearch(value: string) {
  return value.trim().toLowerCase();
}

function findSimilarNominations(
  nominations: ExistingNomination[],
  candidateName: string,
) {
  const query = normalizeSearch(candidateName);

  if (!query) {
    return [];
  }

  return nominations
    .filter((nomination) => {
      const haystack = [nomination.name, nomination.description]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(query) || query.includes(nomination.name.toLowerCase());
    })
    .slice(0, 5);
}

function DuplicateNominationHint({
  candidateName,
  nominations,
  showNominatorInfo,
}: {
  candidateName: string;
  nominations: ExistingNomination[];
  showNominatorInfo: boolean;
}) {
  const query = normalizeSearch(candidateName);
  const matches = useMemo(
    () => findSimilarNominations(nominations, candidateName),
    [candidateName, nominations],
  );

  if (!query) {
    return null;
  }

  if (matches.length === 0) {
    return (
      <div className="rounded-2xl border border-[#EED8AA]/70 bg-[#FFF8E8]/70 px-4 py-3 text-sm text-muted-foreground">
        暂未发现相似的已有提名。
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50/80 p-4">
      <div className="flex items-start gap-2 text-sm font-medium text-amber-900">
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
        找到 {matches.length} 条可能相似的已有提名，请确认是否重复。
      </div>
      <div className="mt-3 space-y-2">
        {matches.map((nomination) => (
          <div
            key={nomination.id}
            className="rounded-xl border border-amber-200 bg-white/70 p-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="break-words font-medium text-amber-950">
                  {nomination.name}
                </div>
                <p className="mt-1 line-clamp-2 break-words text-xs leading-5 text-amber-900/80">
                  {nomination.description || "暂无简介。"}
                </p>
              </div>
              <Badge variant="secondary">
                {nominationStatusLabel[nomination.status]}
              </Badge>
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-amber-900/70">
              {showNominatorInfo && nomination.nominator_display_name ? (
                <span>提名者：{nomination.nominator_display_name}</span>
              ) : null}
              <span>提交时间：{formatDateTime(nomination.created_at)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function NominationCreateForm({
  contestId,
  descriptionMaxLength,
  imageRequired,
  existingNominations,
  showNominatorInfo,
}: {
  contestId: string;
  descriptionMaxLength?: number | null;
  imageRequired?: boolean;
  existingNominations: ExistingNomination[];
  showNominatorInfo: boolean;
}) {
  const [candidateName, setCandidateName] = useState("");

  return (
    <TransitionActionForm
      action={createNominationAction}
      refresh={false}
      successMessage="提名已提交"
    >
      <FormStatusFieldset className="space-y-5">
        <input type="hidden" name="contestId" value={contestId} />
        {imageRequired ? (
          <div className="rounded-2xl border border-amber-300 bg-amber-50/80 px-4 py-3 text-sm leading-6 text-amber-900">
            本活动要求提名图片。提交基础信息后，请继续上传图片；上传成功后才会进入待审核。
          </div>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="name">候选项名称</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="name"
              name="name"
              required
              value={candidateName}
              onChange={(event) => setCandidateName(event.currentTarget.value)}
              placeholder="候选项名称"
              className="pl-9"
            />
          </div>
          <DuplicateNominationHint
            candidateName={candidateName}
            nominations={existingNominations}
            showNominatorInfo={showNominatorInfo}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="description">候选项简介</Label>
          <DescriptionTextarea
            id="description"
            name="description"
            placeholder="简单介绍这个候选项。"
            maxLength={descriptionMaxLength}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="nominator_display_name">提名者</Label>
          <Input
            id="nominator_display_name"
            name="nominator_display_name"
            placeholder="用于公开展示的提名者名称"
          />
        </div>
        <FormSubmitButton className="w-full sm:w-auto" loadingText="提名提交中...">
          提交提名
        </FormSubmitButton>
      </FormStatusFieldset>
    </TransitionActionForm>
  );
}
