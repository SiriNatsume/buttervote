"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ImageIcon, Search } from "lucide-react";
import { updateMyNomination } from "@/lib/actions/nomination-actions";
import { formatDateTime } from "@/lib/time";
import { getPublicImageUrl } from "@/lib/image/image-url";
import type { ContestStatus, NominationStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ApprovedNominationImageUploader } from "@/components/approved-nomination-image-uploader";
import { DescriptionTextarea } from "@/components/description-textarea";
import { FormSubmitButton } from "@/components/form-submit-button";
import { NominationImageUploader } from "@/components/nomination-image-uploader";
import { StatusBadge } from "@/components/contest-badges";
import { TransitionActionForm } from "@/components/transition-action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type MyNominationItem = {
  id: string;
  contest_id: string;
  name: string;
  description: string | null;
  status: NominationStatus;
  rejection_reason?: string | null;
  rejected_at?: string | null;
  created_at: string;
  image_path?: string | null;
  image_width?: number | null;
  image_height?: number | null;
  image_size?: number | null;
  nominator_display_name?: string | null;
  contest: {
    id: string;
    title: string;
    status: ContestStatus;
    candidate_description_max_length: number | null;
    nomination_image_required: boolean;
  } | null;
};

const nominationStatusLabel: Record<NominationStatus, string> = {
  draft: "待上传图片",
  pending: "待审核",
  approved: "已通过",
  rejected: "已拒绝",
};

const nominationStatusClass: Record<NominationStatus, string> = {
  draft: "border-orange-200 bg-orange-100 text-orange-800",
  pending: "border-amber-200 bg-amber-100 text-amber-800",
  approved: "border-yellow-300 bg-yellow-100 text-yellow-800",
  rejected: "border-stone-300 bg-stone-100 text-stone-600",
};

const statusFilters: Array<{ value: "all" | NominationStatus; label: string }> = [
  { value: "all", label: "全部" },
  { value: "pending", label: "待审核" },
  { value: "approved", label: "已通过" },
  { value: "rejected", label: "已拒绝" },
  { value: "draft", label: "待上传图片" },
];

type NominationGroup = {
  key: string;
  title: string;
  contest: MyNominationItem["contest"];
  latestCreatedAt: string;
  nominations: MyNominationItem[];
};

function normalizeSearch(value: string) {
  return value.trim().toLowerCase();
}

function matchesNomination(item: MyNominationItem, query: string) {
  if (!query) {
    return true;
  }

  const haystack = [
    item.name,
    item.description,
    item.contest?.title ?? "未知活动",
    nominationStatusLabel[item.status],
    item.status,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(query);
}

function groupNominationsByContest(items: MyNominationItem[]) {
  const groups = new Map<string, NominationGroup>();

  for (const item of items) {
    const key = item.contest?.id ?? `unknown-${item.contest_id}`;
    const existing = groups.get(key);

    if (existing) {
      existing.nominations.push(item);
      if (item.created_at > existing.latestCreatedAt) {
        existing.latestCreatedAt = item.created_at;
      }
      continue;
    }

    groups.set(key, {
      key,
      title: item.contest?.title ?? "未知活动",
      contest: item.contest,
      latestCreatedAt: item.created_at,
      nominations: [item],
    });
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      nominations: group.nominations.sort((a, b) =>
        b.created_at.localeCompare(a.created_at),
      ),
    }))
    .sort((a, b) => b.latestCreatedAt.localeCompare(a.latestCreatedAt));
}

function NominationStatusBadge({ status }: { status: NominationStatus }) {
  return (
    <Badge variant="outline" className={nominationStatusClass[status]}>
      {nominationStatusLabel[status]}
    </Badge>
  );
}

function NominationSummaryImage({
  nomination,
}: {
  nomination: MyNominationItem;
}) {
  const imageUrl = getPublicImageUrl(nomination.image_path);

  return (
    <div className="size-16 shrink-0 overflow-hidden rounded-2xl bg-muted sm:size-20">
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={`${nomination.name} 图片`}
          className="size-full object-cover"
        />
      ) : (
        <div className="butter-placeholder flex size-full items-center justify-center">
          <ImageIcon className="size-5" aria-hidden="true" />
        </div>
      )}
    </div>
  );
}

function NominationCard({
  nomination,
  editingId,
  onToggleEdit,
}: {
  nomination: MyNominationItem;
  editingId: string | null;
  onToggleEdit: (id: string) => void;
}) {
  const editable =
    nomination.status === "draft" ||
    nomination.status === "pending" ||
    nomination.status === "rejected";
  const isEditing = editingId === nomination.id;
  const needsImageBeforeSubmit =
    nomination.contest?.nomination_image_required === true &&
    !nomination.image_path;
  const canSupplementImage =
    nomination.status === "approved" && !nomination.image_path;

  return (
    <Card className="overflow-hidden bg-[#FFFCF4]/85">
      <CardHeader className="p-4 sm:p-6">
        <div className="flex gap-3">
          <NominationSummaryImage nomination={nomination} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="break-words text-lg leading-snug">
                {nomination.name}
              </CardTitle>
              <NominationStatusBadge status={nomination.status} />
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span>{formatDateTime(nomination.created_at)}</span>
              <span>·</span>
              {nomination.contest ? (
                <Link
                  href={`/contests/${nomination.contest.id}`}
                  className="underline-offset-4 hover:text-primary hover:underline"
                >
                  {nomination.contest.title}
                </Link>
              ) : (
                <span>未知活动</span>
              )}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-0 sm:p-6 sm:pt-0">
        <p className="break-words text-sm leading-6 text-muted-foreground">
          {nomination.description || "暂无简介。"}
        </p>
        {nomination.nominator_display_name ? (
          <div className="rounded-xl bg-[#FFF8E8]/70 px-3 py-2 text-sm text-muted-foreground">
            提名者：{nomination.nominator_display_name}
          </div>
        ) : null}
        {nomination.status === "rejected" ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm leading-6 text-red-800">
            <div className="font-medium">拒绝理由</div>
            <div className="mt-1">
              {nomination.rejection_reason || "管理员未填写拒绝理由。"}
            </div>
          </div>
        ) : null}
        {nomination.status === "draft" ? (
          <div className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-sm leading-6 text-orange-800">
            该提名需要上传图片后才会进入待审核。
          </div>
        ) : null}
        {editable ? (
          <Button
            type="button"
            variant={isEditing ? "secondary" : "outline"}
            className="w-full sm:w-auto"
            onClick={() => onToggleEdit(nomination.id)}
          >
            {isEditing ? "收起编辑" : "编辑"}
          </Button>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              已通过审核的提名不可再由用户修改。
            </p>
            {canSupplementImage ? (
              <ApprovedNominationImageUploader nominationId={nomination.id} />
            ) : null}
          </div>
        )}

        {editable && isEditing ? (
          <div className="grid gap-6 border-t border-[#EED8AA]/70 pt-4 lg:grid-cols-[1fr_260px]">
            <TransitionActionForm
              action={updateMyNomination}
              className="space-y-4"
              successMessage="已保存并重新提交"
            >
              <input type="hidden" name="nominationId" value={nomination.id} />
              <div className="space-y-2">
                <Label htmlFor={`name-${nomination.id}`}>候选项名称</Label>
                <Input
                  id={`name-${nomination.id}`}
                  name="name"
                  required
                  defaultValue={nomination.name}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`description-${nomination.id}`}>
                  候选项简介
                </Label>
                <DescriptionTextarea
                  id={`description-${nomination.id}`}
                  name="description"
                  defaultValue={nomination.description ?? ""}
                  maxLength={
                    nomination.contest?.candidate_description_max_length ?? null
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`nominator-${nomination.id}`}>提名者</Label>
                <Input
                  id={`nominator-${nomination.id}`}
                  name="nominator_display_name"
                  defaultValue={nomination.nominator_display_name ?? ""}
                />
              </div>
              {needsImageBeforeSubmit ? (
                <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900">
                  该活动要求提名图片，请先上传图片后再重新提交。
                </div>
              ) : null}
              <FormSubmitButton
                className="w-full sm:w-auto"
                disabled={needsImageBeforeSubmit}
                loadingText="保存中..."
              >
                {needsImageBeforeSubmit ? "请先上传图片" : "保存并重新提交"}
              </FormSubmitButton>
            </TransitionActionForm>
            <div>
              <NominationImageUploader
                contestId={nomination.contest_id}
                nominationId={nomination.id}
                showActions={false}
                disabled={!editable}
                value={{
                  imagePath: nomination.image_path,
                  imageWidth: nomination.image_width,
                  imageHeight: nomination.image_height,
                  imageSize: nomination.image_size,
                }}
              />
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function MyNominationsGroupedList({
  nominations,
}: {
  nominations: MyNominationItem[];
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | NominationStatus>(
    "all",
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const groups = useMemo(
    () => groupNominationsByContest(nominations),
    [nominations],
  );
  const initialOpenKey = groups[0]?.key;
  const [openGroupIds, setOpenGroupIds] = useState<Set<string>>(
    () => new Set(initialOpenKey ? [initialOpenKey] : []),
  );
  const query = normalizeSearch(search);
  const filteredGroups = useMemo(
    () =>
      groups
        .map((group) => ({
          ...group,
          nominations: group.nominations.filter((nomination) =>
            (statusFilter === "all" || nomination.status === statusFilter) &&
            matchesNomination(nomination, query),
          ),
        }))
        .filter((group) => group.nominations.length > 0),
    [groups, query, statusFilter],
  );
  const totalMatches = filteredGroups.reduce(
    (sum, group) => sum + group.nominations.length,
    0,
  );
  const filteredGroupKeys = filteredGroups.map((group) => group.key).join("|");

  useEffect(() => {
    if (!query) {
      return;
    }

    setOpenGroupIds(new Set(filteredGroups.map((group) => group.key)));
  }, [filteredGroupKeys, filteredGroups, query]);

  function toggleGroup(groupKey: string) {
    setOpenGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  }

  function expandAll() {
    setOpenGroupIds(new Set(filteredGroups.map((group) => group.key)));
  }

  function collapseAll() {
    setOpenGroupIds(new Set());
  }

  if (nominations.length === 0) {
    return (
      <div className="rounded-2xl border p-8 text-muted-foreground">
        你还没有提交过提名。进入正在提名的活动后，可以提交你的第一个候选项。
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[#EED8AA]/70 bg-[#FFFCF4]/85 p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索提名、简介或活动名称"
              className="pl-9"
            />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
            <Button type="button" variant="outline" onClick={expandAll}>
              全部展开
            </Button>
            <Button type="button" variant="outline" onClick={collapseAll}>
              全部收起
            </Button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {statusFilters.map((filter) => (
            <Button
              key={filter.value}
              type="button"
              size="sm"
              variant={statusFilter === filter.value ? "default" : "outline"}
              onClick={() => setStatusFilter(filter.value)}
            >
              {filter.label}
            </Button>
          ))}
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          共 {totalMatches} 条提名
        </p>
      </div>

      {filteredGroups.length > 0 ? (
        <div className="space-y-4">
          {filteredGroups.map((group) => {
            const isOpen = openGroupIds.has(group.key);

            return (
              <section
                key={group.key}
                className="overflow-hidden rounded-3xl border border-[#EED8AA]/70 bg-[#FFFCF4]/80 shadow-sm"
              >
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-4 py-4 text-left transition hover:bg-[#FFF3D0]/60 sm:px-5"
                  onClick={() => toggleGroup(group.key)}
                >
                  {isOpen ? (
                    <ChevronDown className="size-5 shrink-0 text-primary" />
                  ) : (
                    <ChevronRight className="size-5 shrink-0 text-primary" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="break-words text-lg font-semibold">
                        {group.title}
                      </h2>
                      <Badge variant="secondary">
                        {group.nominations.length} 条提名
                      </Badge>
                      {group.contest ? (
                        <StatusBadge status={group.contest.status} />
                      ) : (
                        <Badge variant="outline">未知活动</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      最新提交：{formatDateTime(group.latestCreatedAt)}
                    </p>
                  </div>
                </button>
                <div
                  className={cn(
                    "border-t border-[#EED8AA]/70 p-3 sm:p-4",
                    isOpen ? "block" : "hidden",
                  )}
                >
                  <div className="space-y-3">
                    {group.nominations.map((nomination) => (
                      <NominationCard
                        key={nomination.id}
                        nomination={nomination}
                        editingId={editingId}
                        onToggleEdit={(id) =>
                          setEditingId((current) => (current === id ? null : id))
                        }
                      />
                    ))}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border p-8 text-muted-foreground">
          没有找到匹配的提名。请换个关键词再试。
        </div>
      )}
    </div>
  );
}
