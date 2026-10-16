import type { SupabaseClient } from "@supabase/supabase-js";
import { HomepageSidebarView } from "@/components/homepage-sidebar-view";
import { loadHomepageSidebarData } from "@/lib/homepage-sidebar-data";
import type { HomepageVotingContest, HomepageVotingGroup } from "@/lib/homepage-sidebar";
import type { Database } from "@/lib/types";

export async function HomepageSidebar(props: {
  publicClient: SupabaseClient<Database>;
  contests: HomepageVotingContest[];
  groups: HomepageVotingGroup[];
}) {
  const data = await loadHomepageSidebarData(props);
  return <HomepageSidebarView data={data} />;
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
