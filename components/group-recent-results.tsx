"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { GroupContestControl } from "@/components/group-contest-control";
import { Input } from "@/components/ui/input";
import {
  groupContestMatchesQuery,
  type GroupHomepageContest,
} from "@/lib/group-homepage";

export function GroupRecentResults({
  contests,
  referenceNow,
}: {
  contests: GroupHomepageContest[];
  referenceNow: number;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => contests.filter((contest) => groupContestMatchesQuery(contest, query)),
    [contests, query],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xl font-semibold">已结束</h2>
        <label className="relative block w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索比赛或选项名称"
            aria-label="搜索已结束活动"
            className="pl-9"
          />
        </label>
      </div>
      {filtered.length > 0 ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {filtered.map((contest) => (
            <GroupContestControl
              key={contest.id}
              contest={contest}
              referenceNow={referenceNow}
              href={`/contests/${contest.id}/results`}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-[#DCC69F] px-4 py-8 text-center text-sm text-muted-foreground">
          没有找到匹配的比赛或选项。
        </div>
      )}
    </div>
  );
}
