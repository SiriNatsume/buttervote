"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ImageIcon,
  ListChecks,
  Pencil,
  Search,
} from "lucide-react";
import { statusLabel, voteTypeLabel } from "@/lib/contest-rules";
import { getPublicImageUrl } from "@/lib/image/image-url";
import { formatDateTime } from "@/lib/time";
import type { ContestStatus, VoteType } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ArchiveContestDialog } from "@/components/archive-contest-dialog";
import { ContestStatusSelect } from "@/components/contest-status-select";
import { StatusBadge, VoteTypeBadge } from "@/components/contest-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type AdminContestItem = {
  id: string;
  title: string;
  description: string | null;
  status: ContestStatus;
  vote_type: VoteType;
  max_choices: number;
  image_path?: string | null;
  group_id: string | null;
  created_at: string;
};

export type AdminGroupItem = {
  id: string;
  name: string;
};

type ContestGroupSection = {
  key: string;
  name: string;
  latestCreatedAt: string;
  contests: AdminContestItem[];
};

function normalizeSearch(value: string) {
  return value.trim().toLowerCase();
}

function getContestGroupName(
  contest: AdminContestItem,
  groupNameById: Map<string, string>,
) {
  if (!contest.group_id) {
    return "未分组";
  }

  return groupNameById.get(contest.group_id) ?? "未知活动组";
}

function getContestGroupKey(
  contest: AdminContestItem,
  groupNameById: Map<string, string>,
) {
  if (!contest.group_id) {
    return "__ungrouped";
  }

  return groupNameById.has(contest.group_id) ? contest.group_id : "__unknown";
}

function matchesContest(
  contest: AdminContestItem,
  groupName: string,
  query: string,
) {
  if (!query) {
    return true;
  }

  const haystack = [
    contest.title,
    contest.description,
    groupName,
    statusLabel[contest.status],
    contest.status,
    voteTypeLabel[contest.vote_type],
    contest.vote_type,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(query);
}

function groupContestsByGroup(
  contests: AdminContestItem[],
  groups: AdminGroupItem[],
) {
  const groupNameById = new Map(groups.map((group) => [group.id, group.name]));
  const sections = new Map<string, ContestGroupSection>();

  for (const contest of contests) {
    const key = getContestGroupKey(contest, groupNameById);
    const name = getContestGroupName(contest, groupNameById);
    const existing = sections.get(key);

    if (existing) {
      existing.contests.push(contest);
      if (contest.created_at > existing.latestCreatedAt) {
        existing.latestCreatedAt = contest.created_at;
      }
      continue;
    }

    sections.set(key, {
      key,
      name,
      latestCreatedAt: contest.created_at,
      contests: [contest],
    });
  }

  return Array.from(sections.values())
    .map((section) => ({
      ...section,
      contests: section.contests.sort((a, b) =>
        b.created_at.localeCompare(a.created_at),
      ),
    }))
    .sort((a, b) => b.latestCreatedAt.localeCompare(a.latestCreatedAt));
}

function ContestCover({ contest }: { contest: AdminContestItem }) {
  const imageUrl = getPublicImageUrl(contest.image_path);

  return (
    <div className="aspect-video w-20 overflow-hidden rounded-xl bg-muted">
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={`${contest.title} 封面`}
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

function ContestActions({
  contest,
  onArchived,
}: {
  contest: AdminContestItem;
  onArchived: (contestId: string) => void;
}) {
  return (
    <>
      <Button asChild size="sm" variant="outline" className="w-full md:w-auto">
        <Link href={`/admin/contests/${contest.id}/edit`}>
          <Pencil className="size-4" />
          编辑
        </Link>
      </Button>
      <Button asChild size="sm" variant="outline" className="w-full md:w-auto">
        <Link href={`/admin/contests/${contest.id}/candidates`}>
          <ListChecks className="size-4" />
          选项
        </Link>
      </Button>
      <Button asChild size="sm" variant="outline" className="w-full md:w-auto">
        <Link href={`/contests/${contest.id}`}>打开</Link>
      </Button>
      <ArchiveContestDialog
        contestId={contest.id}
        contestTitle={contest.title}
        onArchived={onArchived}
        refreshOnSuccess={false}
        triggerSize="sm"
        triggerClassName="w-full md:w-auto"
      />
    </>
  );
}

function MobileContestCard({
  contest,
  groupName,
  onArchived,
}: {
  contest: AdminContestItem;
  groupName: string;
  onArchived: (contestId: string) => void;
}) {
  const imageUrl = getPublicImageUrl(contest.image_path);

  return (
    <div className="rounded-2xl border border-[#EED8AA]/70 bg-[#FFFCF4]/85 p-3 shadow-sm">
      <div className="flex gap-3">
        <div className="aspect-video w-24 shrink-0 overflow-hidden rounded-xl bg-muted">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={`${contest.title} 封面`}
              className="size-full object-cover"
            />
          ) : (
            <div className="butter-placeholder flex size-full items-center justify-center">
              <ImageIcon className="size-5" aria-hidden="true" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="break-words font-semibold leading-snug">
            {contest.title}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            活动组：{groupName}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <VoteTypeBadge voteType={contest.vote_type} />
            <StatusBadge status={contest.status} />
          </div>
        </div>
      </div>
      <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-xl bg-[#FFF8E8]/70 px-3 py-2 text-muted-foreground">
          最多可选：{contest.max_choices}
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">状态切换</div>
          <ContestStatusSelect
            contestId={contest.id}
            currentStatus={contest.status}
          />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <ContestActions contest={contest} onArchived={onArchived} />
      </div>
    </div>
  );
}

export function AdminContestsGroupedList({
  contests,
  groups,
}: {
  contests: AdminContestItem[];
  groups: AdminGroupItem[];
}) {
  const [search, setSearch] = useState("");
  const [archivedContestIds, setArchivedContestIds] = useState<Set<string>>(
    () => new Set(),
  );
  const visibleContests = useMemo(
    () => contests.filter((contest) => !archivedContestIds.has(contest.id)),
    [archivedContestIds, contests],
  );
  const groupedSections = useMemo(
    () => groupContestsByGroup(visibleContests, groups),
    [visibleContests, groups],
  );
  const defaultOpenKeys = useMemo(() => {
    const activeStatuses = new Set<ContestStatus>([
      "nominating",
      "admin_nominating",
      "voting",
    ]);
    const keys = groupedSections
      .filter((section) =>
        section.contests.some((contest) => activeStatuses.has(contest.status)),
      )
      .map((section) => section.key);

    return keys.length > 0 ? keys : groupedSections[0] ? [groupedSections[0].key] : [];
  }, [groupedSections]);
  const [openGroupIds, setOpenGroupIds] = useState<Set<string>>(
    () => new Set(defaultOpenKeys),
  );
  const groupNameById = useMemo(
    () => new Map(groups.map((group) => [group.id, group.name])),
    [groups],
  );
  const query = normalizeSearch(search);
  const filteredSections = useMemo(
    () =>
      groupedSections
        .map((section) => ({
          ...section,
          contests: section.contests.filter((contest) =>
            matchesContest(
              contest,
              getContestGroupName(contest, groupNameById),
              query,
            ),
          ),
        }))
        .filter((section) => section.contests.length > 0),
    [groupNameById, groupedSections, query],
  );
  const totalMatches = filteredSections.reduce(
    (sum, section) => sum + section.contests.length,
    0,
  );
  const filteredSectionKeys = filteredSections
    .map((section) => section.key)
    .join("|");

  useEffect(() => {
    if (!query) {
      return;
    }

    setOpenGroupIds(new Set(filteredSections.map((section) => section.key)));
  }, [filteredSectionKeys, filteredSections, query]);

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
    setOpenGroupIds(new Set(filteredSections.map((section) => section.key)));
  }

  function collapseAll() {
    setOpenGroupIds(new Set());
  }

  function archiveContest(contestId: string) {
    setArchivedContestIds((current) => {
      const next = new Set(current);
      next.add(contestId);
      return next;
    });
  }

  if (visibleContests.length === 0) {
    return (
      <div className="rounded-2xl border p-6 text-sm text-muted-foreground">
        暂无活动。创建活动后，可以在这里编辑状态、候选项和活动组。
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
              placeholder="搜索活动、活动组、状态或投票类型"
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
        <p className="mt-3 text-sm text-muted-foreground">
          共 {totalMatches} 个活动
        </p>
      </div>

      {filteredSections.length > 0 ? (
        <div className="space-y-4">
          {filteredSections.map((section) => {
            const isOpen = openGroupIds.has(section.key);

            return (
              <section
                key={section.key}
                className="overflow-hidden rounded-3xl border border-[#EED8AA]/70 bg-[#FFFCF4]/80 shadow-sm"
              >
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-4 py-4 text-left transition hover:bg-[#FFF3D0]/60 sm:px-5"
                  onClick={() => toggleGroup(section.key)}
                >
                  {isOpen ? (
                    <ChevronDown className="size-5 shrink-0 text-primary" />
                  ) : (
                    <ChevronRight className="size-5 shrink-0 text-primary" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="break-words text-lg font-semibold">
                        {section.name}
                      </h2>
                      <Badge variant="secondary">
                        {section.contests.length} 个活动
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      最近创建：{formatDateTime(section.latestCreatedAt)}
                    </p>
                  </div>
                </button>
                <div
                  className={cn(
                    "border-t border-[#EED8AA]/70 p-3 sm:p-4",
                    isOpen ? "block" : "hidden",
                  )}
                >
                  <div className="space-y-3 md:hidden">
                    {section.contests.map((contest) => (
                      <MobileContestCard
                        key={contest.id}
                        contest={contest}
                        groupName={getContestGroupName(contest, groupNameById)}
                        onArchived={archiveContest}
                      />
                    ))}
                  </div>
                  <div className="hidden rounded-2xl border border-[#EED8AA]/70 md:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>封面</TableHead>
                          <TableHead>标题</TableHead>
                          <TableHead>活动组</TableHead>
                          <TableHead>类型</TableHead>
                          <TableHead>状态</TableHead>
                          <TableHead>最多可选</TableHead>
                          <TableHead className="text-right">操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {section.contests.map((contest) => (
                          <TableRow key={contest.id}>
                            <TableCell>
                              <ContestCover contest={contest} />
                            </TableCell>
                            <TableCell className="font-medium">
                              {contest.title}
                            </TableCell>
                            <TableCell>
                              {getContestGroupName(contest, groupNameById)}
                            </TableCell>
                            <TableCell>
                              <VoteTypeBadge voteType={contest.vote_type} />
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-3">
                                <StatusBadge status={contest.status} />
                                <ContestStatusSelect
                                  contestId={contest.id}
                                  currentStatus={contest.status}
                                />
                              </div>
                            </TableCell>
                            <TableCell>{contest.max_choices}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                <ContestActions
                                  contest={contest}
                                  onArchived={archiveContest}
                                />
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border p-8 text-muted-foreground">
          没有找到匹配的活动。请换个关键词或清空搜索条件。
        </div>
      )}
    </div>
  );
}
