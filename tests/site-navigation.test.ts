import assert from "node:assert/strict";
import test from "node:test";
import { siteNavigationFormSchema, siteNavigationSettingsSchema } from "../lib/validation/site-navigation";
import {
  buildActivityBreadcrumbs,
  getPageSection,
  getActiveSection,
  getResultsHref,
  getResultsMembership,
  updateNavigationTargets,
  type SiteNavigationData,
} from "../lib/page-navigation";

const groupId = "11111111-1111-4111-8111-111111111111";
const contestId = "22222222-2222-4222-8222-222222222222";

test("existing navigation settings preserve their results group when the nomination target is absent", () => {
  assert.deepEqual(siteNavigationSettingsSchema.parse({ resultsGroupId: groupId }), {
    resultsGroupId: groupId,
    nominationContestId: null,
  });
});

test("navigation settings preserve independent voting and nomination destinations including disabled entries", () => {
  for (const value of [
    { resultsGroupId: groupId, nominationContestId: contestId },
    { resultsGroupId: null, nominationContestId: contestId },
    { resultsGroupId: groupId, nominationContestId: null },
    { resultsGroupId: null, nominationContestId: null },
  ]) assert.deepEqual(siteNavigationSettingsSchema.parse(value), value);
});

test("navigation form requires explicit valid targets or the disabled option", () => {
  assert.equal(siteNavigationFormSchema.safeParse({ resultsGroupId: groupId, nominationContestId: contestId }).success, true);
  assert.equal(siteNavigationFormSchema.safeParse({ resultsGroupId: "none", nominationContestId: "none" }).success, true);
  assert.equal(siteNavigationFormSchema.safeParse({ resultsGroupId: groupId, nominationContestId: "https://example.com" }).success, false);
  assert.equal(siteNavigationFormSchema.safeParse({ resultsGroupId: "broken", nominationContestId: contestId }).success, false);
});

test("results destinations accept one group or independent contest, never both", () => {
  assert.equal(siteNavigationSettingsSchema.safeParse({ resultsGroupId: null, resultsContestId: contestId }).success, true);
  assert.equal(siteNavigationSettingsSchema.safeParse({ resultsGroupId: groupId, resultsContestId: contestId }).success, false);
  assert.equal(siteNavigationFormSchema.safeParse({ resultsGroupId: "none", resultsContestId: contestId, nominationContestId: "none" }).success, true);
  assert.equal(siteNavigationFormSchema.safeParse({ resultsGroupId: groupId, resultsContestId: contestId, nominationContestId: "none" }).success, false);
});

test("changing or disabling the default entry retains previously assigned section membership", () => {
  const previous = { resultsGroupId: groupId, nominationContestId: null };
  const next = updateNavigationTargets(previous, {
    resultsGroupId: null,
    resultsContestId: contestId,
    nominationContestId: null,
  });
  assert.equal(getResultsHref(next), `/contests/${contestId}`);
  assert.deepEqual(getResultsMembership(next), { resultsGroupIds: [groupId], resultsContestIds: [contestId] });
  const disabled = updateNavigationTargets(next, {
    resultsGroupId: null,
    resultsContestId: null,
    nominationContestId: null,
  });
  assert.equal(getResultsHref(disabled), null);
  assert.deepEqual(getResultsMembership(disabled), getResultsMembership(next));
  assert.deepEqual(siteNavigationSettingsSchema.parse(disabled), disabled);
  assert.deepEqual(previous, { resultsGroupId: groupId, nominationContestId: null });
});

const group = { id: groupId, name: "5th 工萌 · 人外杯" };
const contest = { id: contestId, title: "半决赛第一场", group_id: groupId };
const settings = { resultsGroupId: groupId, nominationContestId: null };
const navigation: SiteNavigationData = {
  resultsHref: `/groups/${groupId}`,
  resultsGroupIds: [groupId],
  resultsContestIds: [contestId],
};

test("all group and contest descendants retain their assigned top-level section", () => {
  for (const suffix of ["", "/", "/vote", "/nominate", "/results", "/my-nominations"]) {
    assert.equal(getPageSection(`/groups/${groupId}${suffix}`, navigation), "results");
    assert.equal(getPageSection(`/contests/${contestId}${suffix}`, navigation), "results");
  }
  assert.equal(getPageSection(`/contests/${contestId}/results?view=bracket#round-2`, navigation), "results");
  assert.equal(getPageSection(`/groups/${groupId}-other/vote`, navigation), "home");
  assert.equal(getPageSection("/contests/unassigned/nominate", navigation), "home");
  assert.equal(getPageSection("/groups/unassigned", navigation), "home");
});

test("home and hall of fame are peer roots; admin and account pages do not select a public section", () => {
  assert.equal(getPageSection("/", navigation), "home");
  assert.equal(getPageSection("/hall-of-fame", navigation), "hall-of-fame");
  assert.equal(getPageSection("/hall-of-fame/champions", navigation), "hall-of-fame");
  for (const path of ["/admin", "/admin/hall-of-fame", "/me/nominations", "/login", "/hall-of-fame-other"]) {
    assert.equal(getPageSection(path, navigation), null);
  }
});

test("results breadcrumbs start at their section and contain clickable resource parents", () => {
  assert.deepEqual(buildActivityBreadcrumbs(settings, { group }), [
    { label: "赛程结果" },
    { label: group.name },
  ]);
  assert.deepEqual(buildActivityBreadcrumbs(settings, { group, contest, current: "投票结果" }), [
    { label: "赛程结果" },
    { label: group.name, href: `/groups/${groupId}` },
    { label: contest.title, href: `/contests/${contestId}` },
    { label: "投票结果" },
  ]);
  for (const current of ["本轮投票", "参与提名", "赛程结果", "我的提名"]) {
    const items = buildActivityBreadcrumbs(settings, { group, contest, current });
    assert.equal(items[0].label, "赛程结果");
    assert.deepEqual(items.at(-1), { label: current });
  }
});

test("unassigned activities stay under home and retain their real group hierarchy", () => {
  assert.deepEqual(buildActivityBreadcrumbs({ resultsGroupId: null, nominationContestId: null }, {
    group,
    contest,
    current: "参与提名",
  }), [
    { label: "活动首页", href: "/" },
    { label: group.name, href: `/groups/${groupId}` },
    { label: contest.title, href: `/contests/${contestId}` },
    { label: "参与提名" },
  ]);
});

test("an individually assigned contest does not invent a results parent for its unassigned group", () => {
  const directSettings = { resultsGroupId: null, resultsContestId: contestId, nominationContestId: null };
  assert.deepEqual(buildActivityBreadcrumbs(directSettings, { group, contest, current: "投票结果" }), [
    { label: "赛程结果" },
    { label: contest.title, href: `/contests/${contestId}` },
    { label: "投票结果" },
  ]);
  assert.deepEqual(buildActivityBreadcrumbs(directSettings, { contest: { ...contest, group_id: null } }), [
    { label: "赛程结果" },
    { label: contest.title },
  ]);
});

test("missing optional group metadata does not misclassify a contest with a known group relationship", () => {
  assert.deepEqual(buildActivityBreadcrumbs(settings, { contest, group: null, current: "我的提名" }), [
    { label: "赛程结果" },
    { label: contest.title, href: `/contests/${contestId}` },
    { label: "我的提名" },
  ]);
});

test("current page metadata overrides an older layout snapshot without leaking to the next route", () => {
  const path = "/contests/newly-assigned/nominate";
  const currentPage = { pathname: path, section: "results" as const };
  assert.equal(getPageSection(path, navigation), "home");
  assert.equal(getActiveSection(path, navigation, currentPage), "results");
  assert.equal(getActiveSection("/contests/unassigned", navigation, currentPage), "home");
  assert.equal(getActiveSection("/hall-of-fame", navigation, currentPage), "hall-of-fame");
  assert.equal(getActiveSection("/admin", navigation, currentPage), null);
  assert.equal(getActiveSection(path, navigation, null), "home");
});
