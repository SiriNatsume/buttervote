import "server-only";

import { cache } from "react";
import { getResultsHref, getResultsMembership, type SiteNavigationData } from "@/lib/page-navigation";
import { createClient } from "@/lib/supabase/server";
import { getPublicSiteSettings } from "@/lib/site-settings";
import { fetchAllRows } from "@/lib/supabase-pagination";
import type { SiteNavigationValue } from "@/lib/types";
import { siteNavigationSettingsSchema } from "@/lib/validation/site-navigation";

const defaultResultsGroupId = "3098422a-97aa-482d-a9e6-a4d7e8a67f43";

export const getSiteNavigationSettings = cache(
  async (): Promise<SiteNavigationValue> => {
    const settings = await getPublicSiteSettings();
    const parsed = siteNavigationSettingsSchema.safeParse(settings.get("site_navigation"));
    return parsed.success
      ? parsed.data
      : { resultsGroupId: defaultResultsGroupId, nominationContestId: null };
  },
);

export const getSiteNavigationData = cache(async (): Promise<SiteNavigationData> => {
  const settings = await getSiteNavigationSettings();
  const membership = getResultsMembership(settings);
  if (!membership.resultsGroupIds.length) {
    return { ...membership, resultsHref: getResultsHref(settings) };
  }

  // Public navigation only receives visible contest IDs, never privileged
  // activity names or private records from the server-data client.
  const supabase = await createClient();
  const { data, error } = await fetchAllRows(() => supabase
    .from("contests")
    .select("id", { count: "exact" })
    .in("group_id", membership.resultsGroupIds)
    .is("archived_at", null)
    .neq("status", "draft")
    .order("id", { ascending: true }));
  if (error) throw new Error(`Failed to load navigation activity relationships: ${error.message}`);

  return {
    ...membership,
    resultsHref: getResultsHref(settings),
    resultsContestIds: [...new Set([...membership.resultsContestIds, ...data.map((contest) => contest.id)])],
  };
});
