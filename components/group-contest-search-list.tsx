"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { ContestCard, type ContestCardContest } from "@/components/contest-card";
import { MascotEmptyState } from "@/components/mascot";
import { Input } from "@/components/ui/input";
import { statusLabel, voteTypeLabel } from "@/lib/contest-rules";

type GroupContestSearchListProps = {
  contests: ContestCardContest[];
};

function contestSearchText(contest: ContestCardContest) {
  return [
    contest.title,
    contest.description,
    statusLabel[contest.status],
    voteTypeLabel[contest.vote_type],
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function GroupContestSearchList({ contests }: GroupContestSearchListProps) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredContests = useMemo(() => {
    if (!normalizedQuery) {
      return contests;
    }

    return contests.filter((contest) =>
      contestSearchText(contest).includes(normalizedQuery),
    );
  }, [contests, normalizedQuery]);

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">活动</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {normalizedQuery
              ? `匹配 ${filteredContests.length} / ${contests.length} 个活动`
              : `共 ${contests.length} 个活动`}
          </p>
        </div>
        <label className="relative block w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索活动名称、简介或状态"
            className="pl-9"
            aria-label="搜索活动"
          />
        </label>
      </div>

      {contests.length === 0 ? (
        <MascotEmptyState kind="emptyContests" title="该活动组暂无公开活动">
          活动发布后会在这里展示。
        </MascotEmptyState>
      ) : filteredContests.length > 0 ? (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {filteredContests.map((contest) => (
            <ContestCard key={contest.id} contest={contest} />
          ))}
        </div>
      ) : (
        <MascotEmptyState kind="emptyContests" title="没有找到匹配的活动" compact>
          试试换个关键词，或清空搜索条件。
        </MascotEmptyState>
      )}
    </section>
  );
}