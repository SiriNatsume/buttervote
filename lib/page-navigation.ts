import type { SiteNavigationValue } from "./types";

export type SiteSection = "home" | "results" | "hall-of-fame";

export type PageSection = { pathname: string; section: SiteSection };

export type BreadcrumbItem = {
  label: string;
  href?: string;
};

export type NavigationGroup = { id: string; name: string };
export type NavigationContest = { id: string; title: string; group_id: string | null };

export type SiteNavigationData = {
  resultsHref: string | null;
  resultsGroupIds: string[];
  // Includes both individually assigned contests and visible children of assigned groups.
  resultsContestIds: string[];
};

export function getResultsMembership(settings: SiteNavigationValue) {
  return {
    resultsGroupIds: [...new Set([
      ...(settings.resultsGroupIds ?? []),
      ...(settings.resultsGroupId ? [settings.resultsGroupId] : []),
    ])],
    resultsContestIds: [...new Set([
      ...(settings.resultsContestIds ?? []),
      ...(settings.resultsContestId ? [settings.resultsContestId] : []),
    ])],
  };
}

export function getResultsHref(settings: SiteNavigationValue) {
  if (settings.resultsGroupId) return `/groups/${settings.resultsGroupId}`;
  if (settings.resultsContestId) return `/contests/${settings.resultsContestId}`;
  return null;
}

export function updateNavigationTargets(
  previous: SiteNavigationValue,
  targets: Pick<SiteNavigationValue, "resultsGroupId" | "resultsContestId" | "nominationContestId">,
): SiteNavigationValue {
  const membership = getResultsMembership(previous);
  const value = { ...targets, ...membership };
  return { ...value, ...getResultsMembership(value) };
}

export function getActivitySection(
  membership: Pick<SiteNavigationData, "resultsGroupIds" | "resultsContestIds">,
  input: { groupId?: string | null; contestId?: string },
): SiteSection {
  return (input.groupId && membership.resultsGroupIds.includes(input.groupId)) ||
    (input.contestId && membership.resultsContestIds.includes(input.contestId))
    ? "results"
    : "home";
}

export function getPageSection(pathname: string, navigation: SiteNavigationData): SiteSection | null {
  const path = pathname.split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";
  if (path === "/") return "home";
  if (path === "/hall-of-fame" || path.startsWith("/hall-of-fame/")) return "hall-of-fame";
  const group = /^\/groups\/([^/]+)(?:\/|$)/.exec(path);
  if (group) return getActivitySection(navigation, { groupId: group[1] });
  const contest = /^\/contests\/([^/]+)(?:\/|$)/.exec(path);
  if (contest) return getActivitySection(navigation, { contestId: contest[1] });
  return null;
}

export function getActiveSection(
  pathname: string,
  navigation: SiteNavigationData,
  currentPage: PageSection | null,
) {
  return currentPage?.pathname === pathname
    ? currentPage.section
    : getPageSection(pathname, navigation);
}

export function buildActivityBreadcrumbs(
  settings: SiteNavigationValue,
  input: {
    group?: NavigationGroup | null;
    contest?: NavigationContest;
    current?: string;
  },
): BreadcrumbItem[] {
  const membership = getResultsMembership(settings);
  const section = getActivitySection(membership, {
    groupId: input.contest?.group_id ?? input.group?.id,
    contestId: input.contest?.id,
  });
  // The results tab opens an assigned resource directly, so it has no separate
  // directory page. Keep the section label distinct from the resource link.
  const items: BreadcrumbItem[] = [section === "results"
    ? { label: "赛程结果" }
    : { label: "活动首页", href: "/" }];

  // An individually assigned contest can belong to a different section from
  // its group. Only show parents that belong to the same section.
  if (input.group && getActivitySection(membership, { groupId: input.group.id }) === section) {
    items.push({ label: input.group.name, href: `/groups/${input.group.id}` });
  }
  if (input.contest) {
    items.push({ label: input.contest.title, href: `/contests/${input.contest.id}` });
  }
  if (input.current) items.push({ label: input.current });
  const current = items.at(-1);
  if (current) delete current.href;
  return items;
}
