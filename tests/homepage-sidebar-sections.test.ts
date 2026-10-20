import assert from "node:assert/strict";
import test from "node:test";
import { buildHomepageSidebarSections } from "../lib/homepage-sidebar-sections";
import type { buildHomepageSidebarData } from "../lib/homepage-sidebar";
import type { GroupHomepageContest } from "../lib/group-homepage";

const input: Parameters<typeof buildHomepageSidebarData>[0] = {
  contests: [], groups: [], cards: [], activeCandidates: [],
  navigation: { resultsGroupId: null, nominationContestId: null },
  signedIn: true, isAdmin: false, allowedGroupIds: [], votes: [],
  loveAllocations: [], nominations: [], personalDataAvailable: true,
  loveDataAvailable: true, nominationDataAvailable: true,
  referenceNow: Date.parse("2026-10-20T00:00:00Z"),
};

test("slow public cards do not delay the personal overview", async () => {
  let resolveCards!: (cards: GroupHomepageContest[]) => void;
  const cards = new Promise<GroupHomepageContest[]>((resolve) => { resolveCards = resolve; });
  const sections = buildHomepageSidebarSections(Promise.resolve(input), cards);
  let matchesResolved = false;
  void sections.matches.then(() => { matchesResolved = true; });
  const overview = await sections.personal;
  assert.equal(overview.signedIn, true);
  assert.equal(overview.personalDataAvailable, true);
  assert.equal(matchesResolved, false);
  resolveCards([]);
  const matches = await sections.matches;
  assert.equal(matches.referenceNow, overview.referenceNow);
});

test("card failures preserve the already loaded personal section", async () => {
  const sections = buildHomepageSidebarSections(Promise.resolve(input), Promise.reject(new Error("cards unavailable")));
  const [personal, matches] = await Promise.allSettled([sections.personal, sections.matches]);
  assert.equal(personal.status, "fulfilled");
  assert.equal(matches.status, "rejected");
});
