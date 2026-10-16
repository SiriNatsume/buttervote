"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, Heart } from "lucide-react";
import { MascotFigure } from "@/components/mascot";
import { GroupContestControl } from "@/components/group-contest-control";
import { homepageActionHref, type HomepageSidebarData } from "@/lib/homepage-sidebar";
import { actionStyles } from "@/lib/action-styles";

type MatchFilter = "all" | "pending" | "voted";

const actionClassName = "flex h-11 w-full items-center justify-center px-3 py-2 text-center text-xs font-medium lg:h-10";
const nominationActionClassName = `${actionClassName} ${actionStyles.nomination}`;
const secondaryActionClassName = `${actionClassName} ${actionStyles.view}`;

export function HomepageSidebarView({ data }: { data: HomepageSidebarData }) {
  const [filter, setFilter] = useState<MatchFilter>("all");
  const [expanded, setExpanded] = useState(false);
  const showPersonal = data.signedIn && data.personalDataAvailable;
  const showNominations = data.signedIn && data.nominationDataAvailable;
  const showNominationAction = data.canNominate && Boolean(data.nominationActionHref);
  const voteActionLabel = data.canSupplementLoveVote ? "补投真爱票" : "前往投票";
  const voteActionClassName = `${actionClassName} ${data.canSupplementLoveVote ? actionStyles.loveParticipation : actionStyles.participation} mt-3`;
  const activeFilter = showPersonal ? filter : "all";
  const progress = data.eligibleCount ? (data.votedCount / data.eligibleCount) * 100 : 0;
  const filteredMatches = data.matches.filter((match) =>
    activeFilter === "all" || (match.canParticipate && (activeFilter === "voted" ? match.hasVoted : !match.hasVoted)),
  );

  return (
    <div className="space-y-5">
      <div className="relative isolate overflow-hidden rounded-3xl border border-[#EED8AA]/80 bg-[#FFF8E8] p-4 shadow-sm">
        <MascotFigure kind="homepageWelcome" decorative className="absolute right-3 top-3 -z-10 h-28 w-20 opacity-90" />
        <section aria-labelledby="homepage-my-votes">
          <h2 id="homepage-my-votes" className="relative z-10 mb-2 text-base font-semibold">我的投票</h2>
          <p className="text-xs text-muted-foreground">当前待投</p>
          <p className="mt-1 flex items-baseline gap-2 text-[2.5rem] font-semibold leading-none tabular-nums tracking-tight text-[#6A3E21]">
            {showPersonal ? String(data.pendingCount).padStart(2, "0") : "—"}<span className="text-xs font-normal text-muted-foreground">场</span>
          </p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#EFDFC0]" role={showPersonal ? "progressbar" : undefined} aria-label="当前投票完成进度" aria-valuemin={showPersonal ? 0 : undefined} aria-valuemax={showPersonal ? data.eligibleCount || 1 : undefined} aria-valuenow={showPersonal ? data.votedCount : undefined}>
            <div className="h-full rounded-full bg-[#D5AF4B] transition-[width] motion-reduce:transition-none" style={{ width: `${showPersonal ? progress : 0}%` }} />
          </div>
          <div className="mt-1.5 flex justify-between gap-2 text-[11px] text-muted-foreground">
            <span>{!showPersonal ? data.signedIn ? "投票记录暂时无法加载" : "登录后查看投票进度" : data.eligibleCount === 0 ? "暂无可参与的投票" : data.pendingCount === 0 ? "当前投票已完成" : "当前投票进度"}</span>
            <span className="shrink-0 tabular-nums">{showPersonal ? `${data.votedCount} / ${data.eligibleCount}` : "— / —"}</span>
          </div>
          <div className="mt-3 border-t border-[#EED8AA]/70 pt-2">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-1.5 text-[#A45D64]"><Heart className="size-3.5" aria-hidden="true" />我的真爱票</span>
              {!showPersonal || data.loveBalances === null ? (
                <span className="text-muted-foreground">— 张可用</span>
              ) : !data.loveBalances.length ? (
                <span className="text-muted-foreground">0 张可用</span>
              ) : null}
            </div>
            {showPersonal && data.loveBalances?.map((group) => (
              <div key={group.id} className="mt-1.5 flex items-center justify-between gap-3 text-xs">
                <span className="truncate text-muted-foreground" title={group.name}>{group.name}</span>
                <span className="shrink-0"><strong className="tabular-nums">{group.remaining}</strong> 张可用</span>
              </div>
            ))}
            {showPersonal && data.loveBalances === null ? <p className="mt-1.5 text-xs text-muted-foreground">真爱票额度暂时无法加载</p> : null}
          </div>
          {data.actionHref ? (
            <Link href={homepageActionHref(data.signedIn, data.actionHref)} className={voteActionClassName}>
              {voteActionLabel}
            </Link>
          ) : (
            <button type="button" disabled className={`${voteActionClassName} cursor-not-allowed opacity-50`}>
              {voteActionLabel}
            </button>
          )}
        </section>

        <section aria-labelledby="homepage-my-nominations" className="mt-4 border-t border-[#EED8AA]/80 pt-4">
          <h2 id="homepage-my-nominations" className="mb-3 text-base font-semibold">我的提名</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">剩余可提名数</p>
              <p className="mt-1 flex min-h-10 items-baseline gap-1.5 text-[2rem] font-semibold leading-10 tabular-nums tracking-tight text-[#6A3E21]">
                {!showNominations ? "—" : data.remainingNominationCount === null ? "不限" : data.remainingNominationCount}
                {!showNominations || data.remainingNominationCount !== null ? <span className="text-xs font-normal text-muted-foreground">个</span> : null}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">已提名数</p>
              <p className="mt-1 flex min-h-10 items-baseline gap-1.5 text-[2rem] font-semibold leading-10 tabular-nums tracking-tight text-[#6A3E21]">
                {showNominations ? data.nominatedCount : "—"}<span className="text-xs font-normal text-muted-foreground">个</span>
              </p>
            </div>
          </div>
          <div className={`mt-2 grid gap-3 ${showNominationAction ? "grid-cols-2" : "grid-cols-1"}`}>
            {showNominationAction && data.nominationActionHref ? (
              <Link href={homepageActionHref(data.signedIn, data.nominationActionHref)} className={nominationActionClassName}>前往提名</Link>
            ) : null}
            {data.nominationHistoryHref ? (
              <Link href={homepageActionHref(data.signedIn, data.nominationHistoryHref)} className={secondaryActionClassName}>查看提名</Link>
            ) : (
              <button type="button" disabled className={`${secondaryActionClassName} cursor-not-allowed opacity-50`}>查看提名</button>
            )}
          </div>
          {data.signedIn && !showNominations ? <p className="mt-2 text-xs text-muted-foreground">提名记录暂时无法加载，请稍后刷新。</p> : null}
        </section>
      </div>

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
    </div>
  );
}
