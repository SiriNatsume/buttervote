"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { GroupContestControl } from "@/components/group-contest-control";
import type { HomepageSidebarData } from "@/lib/homepage-sidebar";
import { actionStyles } from "@/lib/action-styles";

type MatchFilter = "all" | "pending" | "voted";

export function HomepageMatchesView({ data }: {
  data: Pick<HomepageSidebarData, "signedIn" | "personalDataAvailable" | "pendingCount" | "matches" | "referenceNow">;
}) {
  const [filter, setFilter] = useState<MatchFilter>("all");
  const [expanded, setExpanded] = useState(false);
  const showPersonal = data.signedIn && data.personalDataAvailable;
  const activeFilter = showPersonal ? filter : "all";
  const filteredMatches = data.matches.filter((match) =>
    activeFilter === "all" || (match.canParticipate && (activeFilter === "voted" ? match.hasVoted : !match.hasVoted)),
  );

  return (
    <section aria-labelledby="homepage-ongoing-matches">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id="homepage-ongoing-matches" className="text-base font-semibold">进行中的对阵</h2>
        <span className="rounded-full bg-[#F4EAD7] px-2 py-0.5 text-xs tabular-nums text-muted-foreground">{data.matches.length}</span>
      </div>
      {showPersonal ? (
        <div className="mb-2 flex gap-1 rounded-xl bg-[#F4EAD7]/60 p-1" role="group" aria-label="对阵筛选">
          {([
            ["all", "全部"],
            ["pending", `待我投票 ${data.pendingCount}`],
            ["voted", "已参与"],
          ] as const).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={activeFilter === value} onClick={() => { setFilter(value); setExpanded(false); }} className={`min-h-11 flex-1 rounded-lg px-1 text-xs transition-colors lg:min-h-8 ${activeFilter === value ? "bg-[#FFFCF4] font-medium text-[#6A3E21] shadow-sm" : "text-muted-foreground hover:bg-[#FFFCF4]/60"}`}>
              {label}
            </button>
          ))}
        </div>
      ) : null}
      <div id="homepage-ongoing-list" className="space-y-2.5" aria-live="polite" aria-atomic="false">
        {filteredMatches.length ? filteredMatches.map((match, index) => (
          <div
            key={match.id}
            data-homepage-match={match.id}
            className={!expanded && index >= 4 ? "hidden lg:block" : undefined}
          >
            {match.card ? (
              <GroupContestControl
                contest={match.card}
                referenceNow={data.referenceNow}
                href={match.detailHref}
              />
            ) : (
              <Link href={match.detailHref} className="block rounded-xl border border-[#DCC69F] bg-[#FFFCF4] p-3 text-sm">
                {match.title}
              </Link>
            )}
          </div>
        )) : (
          <div className="rounded-2xl border border-dashed border-[#DFCBA5] px-5 py-7 text-center text-sm leading-6 text-muted-foreground">
            {activeFilter === "pending" ? "当前没有待投的场次" : activeFilter === "voted" ? "尚未参与当前场次" : "暂无进行中的对阵"}
            {activeFilter !== "all" ? <button type="button" className={`${actionStyles.view} mt-2 block min-h-11 w-full text-xs lg:min-h-8`} onClick={() => setFilter("all")}>查看全部对阵</button> : null}
          </div>
        )}
      </div>
      {filteredMatches.length > 4 ? (
        <button type="button" aria-controls="homepage-ongoing-list" aria-expanded={expanded} onClick={() => setExpanded(!expanded)} className={`${actionStyles.view} mt-2 flex min-h-11 w-full items-center justify-center gap-1 text-xs lg:hidden`}>
          {expanded ? "收起对阵" : `展开其余 ${filteredMatches.length - 4} 场`}
          <ChevronDown className={`size-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
      ) : null}
    </section>
  );
}
