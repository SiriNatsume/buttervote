import { cache } from "react";
import { PageBreadcrumb } from "@/components/page-breadcrumb";
import { buildActivityBreadcrumbs, getActivitySection, getResultsMembership, type NavigationContest, type NavigationGroup } from "@/lib/page-navigation";
import { getSiteNavigationSettings } from "@/lib/site-navigation";
import { createClient } from "@/lib/supabase/server";

const getBreadcrumbGroup = cache(async (id: string) => {
  const supabase = await createClient();
  const { data, error } = await supabase.from("contest_groups").select("id,name").eq("id", id).maybeSingle();
  if (error) throw new Error(`Failed to load breadcrumb activity group: ${error.message}`);
  return data;
});

export async function ActivityBreadcrumb({ group, contest, current, className }: {
  group?: NavigationGroup | null;
  contest?: NavigationContest;
  current?: string;
  className?: string;
}) {
  const [settings, parent] = await Promise.all([
    getSiteNavigationSettings(),
    group === undefined && contest?.group_id ? getBreadcrumbGroup(contest.group_id) : group,
  ]);
  const section = getActivitySection(getResultsMembership(settings), {
    groupId: contest?.group_id ?? parent?.id,
    contestId: contest?.id,
  });
  return <PageBreadcrumb items={buildActivityBreadcrumbs(settings, { group: parent, contest, current })} section={section} className={className} />;
}
