import { Suspense } from "react";
import { HomepageMatchesView } from "@/components/homepage-sidebar-view";
import { HomepagePersonalOverview } from "@/components/homepage-personal-overview";
import { loadHomepageSidebarSections, type HomepageSidebarInput } from "@/lib/homepage-sidebar-data";
import type { HomepageSidebarData } from "@/lib/homepage-sidebar";

async function PersonalOverview({ data }: { data: Promise<HomepageSidebarData> }) {
  return <HomepagePersonalOverview data={await data} />;
}

async function OngoingMatches({ data }: { data: Promise<HomepageSidebarData> }) {
  const { signedIn, personalDataAvailable, pendingCount, matches, referenceNow } = await data;
  return <HomepageMatchesView data={{ signedIn, personalDataAvailable, pendingCount, matches, referenceNow }} />;
}

export function HomepageSidebar(props: HomepageSidebarInput) {
  const data = loadHomepageSidebarSections(props);
  return (
    <div className="space-y-5">
      <Suspense fallback={<div className="h-[26rem] animate-pulse rounded-3xl border border-[#EED8AA]/80 bg-[#FFF8E8] motion-reduce:animate-none" role="status" aria-label="正在加载我的投票与提名" />}>
        <PersonalOverview data={data.personal} />
      </Suspense>
      <Suspense fallback={<div className="h-80 animate-pulse rounded-2xl border border-[#EED8AA]/80 bg-[#FFF8E8] motion-reduce:animate-none" role="status" aria-label="正在加载进行中的对阵" />}>
        <OngoingMatches data={data.matches} />
      </Suspense>
    </div>
  );
}

export function HomepageSidebarSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="正在加载投票与提名概览">
      <div className="h-[26rem] animate-pulse rounded-3xl border border-[#EED8AA]/80 bg-[#FFF8E8] motion-reduce:animate-none" />
      <div className="h-80 animate-pulse rounded-2xl border border-[#EED8AA]/80 bg-[#FFF8E8] motion-reduce:animate-none" />
      <span className="sr-only">正在加载投票与提名概览</span>
    </div>
  );
}
