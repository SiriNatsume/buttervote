import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHomepageSidebarData,
  homepageActionHref,
  isHomepageVotingOpen,
  type HomepageVotingContest,
  type HomepageVotingGroup,
} from "../lib/homepage-sidebar";

const now = Date.parse("2026-10-15T08:00:00Z");
const group: HomepageVotingGroup = {
  id: "group",
  name: "本届比赛",
  access_mode: "public",
  love_vote_quota: 3,
  love_vote_weight: 3,
};

function contest(id: string, overrides: Partial<HomepageVotingContest> = {}): HomepageVotingContest {
  return {
    id,
    title: `第 ${id} 场`,
    description: null,
    image_path: null,
    live_results_enabled: false,
    updated_at: new Date(now).toISOString(),
    status: "voting",
    vote_type: "single",
    group_id: "group",
    show_candidate_image: true,
    love_vote_enabled: true,
    max_nominations_per_user: 3,
    voting_starts_at: null,
    voting_ends_at: null,
    ...overrides,
  };
}

function sidebar(overrides: Partial<Parameters<typeof buildHomepageSidebarData>[0]> = {}) {
  return buildHomepageSidebarData({
    contests: [contest("1"), contest("2")],
    groups: [group],
    cards: [],
    activeCandidates: [],
    navigation: { resultsGroupId: group.id, nominationContestId: "nominate" },
    signedIn: true,
    isAdmin: false,
    allowedGroupIds: [],
    votes: [],
    loveAllocations: [],
    nominations: [],
    personalDataAvailable: true,
    loveDataAvailable: true,
    nominationDataAvailable: true,
    referenceNow: now,
    ...overrides,
  });
}

function ordinaryVotes(...contestIds: string[]) {
  return contestIds.map((id) => ({
    id: `vote-${id}`,
    contest_id: id,
    payload: { candidateId: `candidate-${id}` },
  }));
}

function loveAllocations(...groupIds: Array<string | null>) {
  return groupIds.map((groupId, index) => ({
    group_id: groupId,
    vote_id: `earlier-vote-${index}`,
    candidate_id: `earlier-candidate-${index}`,
  }));
}

function supplement(overrides: Partial<Parameters<typeof buildHomepageSidebarData>[0]> = {}) {
  return sidebar({
    votes: ordinaryVotes("1"),
    activeCandidates: [{ id: "candidate-1", contest_id: "1" }],
    ...overrides,
  });
}

test("homepage excludes ended, not yet started, and non-voting contests", () => {
  assert.equal(isHomepageVotingOpen(contest("open"), now), true);
  for (const value of [
    contest("closed", { status: "closed" }),
    contest("published", { status: "published" }),
    contest("ended", { voting_ends_at: new Date(now).toISOString() }),
    contest("future", { voting_starts_at: new Date(now + 1).toISOString() }),
  ]) {
    assert.equal(isHomepageVotingOpen(value, now), false);
  }
});

test("personal totals exclude restricted and missing groups while public matches remain visible", () => {
  const result = sidebar({
    contests: [contest("1"), contest("2", { group_id: "restricted" }), contest("3", { group_id: "missing" }), contest("4", { group_id: null })],
    groups: [group, { ...group, id: "restricted", access_mode: "restricted" }],
    votes: ordinaryVotes("1", "2", "old-round"),
  });
  assert.equal(result.matches.length, 4);
  assert.equal(result.eligibleCount, 2);
  assert.equal(result.votedCount, 1);
  assert.equal(result.pendingCount, 1);
  assert.equal(result.actionHref, "/groups/group/vote");
  assert.equal(result.matches.find((match) => match.id === "1")?.voteHref, "/groups/group/vote");
  assert.equal(result.matches.find((match) => match.id === "4")?.voteHref, "/contests/4/vote");
  assert.equal(result.matches.find((match) => match.id === "2")?.canParticipate, false);
});

test("group membership and administrators can participate in restricted contests", () => {
  const restricted = { ...group, access_mode: "restricted" as const };
  assert.equal(sidebar({ groups: [restricted] }).eligibleCount, 0);
  assert.equal(sidebar({ groups: [restricted], allowedGroupIds: [group.id] }).eligibleCount, 2);
  assert.equal(sidebar({ groups: [restricted], isAdmin: true }).eligibleCount, 2);
});

test("love balances remain separate per group and deduct allocations from previous rounds", () => {
  const result = sidebar({
    contests: [contest("1"), contest("2"), contest("3", { group_id: "other" }), contest("4", { group_id: "disabled", love_vote_enabled: false })],
    groups: [group, { ...group, id: "other", love_vote_quota: 1 }, { ...group, id: "disabled" }],
    loveAllocations: loveAllocations(group.id, group.id, "other", "other", null),
  });
  assert.deepEqual(result.loveBalances?.map((balance) => [balance.id, balance.remaining]), [["group", 1], ["other", 0]]);
  assert.equal(result.matches.find((match) => match.id === "3")?.voteHref, "/groups/other/vote");
});

test("guest and failed personal reads never present a false completed ballot or quota", () => {
  for (const overrides of [{ signedIn: false }, { personalDataAvailable: false }]) {
    const result = sidebar({ ...overrides, votes: ordinaryVotes("1", "2") });
    assert.equal(result.eligibleCount, 0);
    assert.equal(result.loveBalances, null);
    assert.equal(result.matches[0].hasVoted, null);
    assert.equal(result.matches[0].canParticipate, false);
  }
  assert.equal(sidebar({ loveDataAvailable: false }).loveBalances, null);
});

test("shared match cards preserve all participants and honor candidate image settings", () => {
  const participants = ["a", "b", "c"].map((id) => ({
    id, name: id, imageUrl: `https://example.com/${id}.webp`, score: null,
    normalScore: null, loveScore: null, loveVoteCount: null, isWinner: false,
  }));
  const result = sidebar({
    contests: [contest("1", { show_candidate_image: false, vote_type: "multiple" })],
    cards: [{
      id: "1", voteHref: "/groups/group/vote", title: "第 1 场", description: null, imageUrl: null,
      status: "voting", voteType: "multiple", votingStartsAt: null, votingEndsAt: null,
      updatedAt: new Date(now).toISOString(), resultVisible: false, breakdownVisible: false,
      loveVoteWeight: null, participants, searchText: "第 1 场",
    }],
  });
  assert.equal(result.matches[0].card?.participants.length, 3);
  assert.deepEqual(result.matches[0].card?.participants.map((participant) => participant.imageUrl), [null, null, null]);
  assert.equal(result.matches[0].card?.resultVisible, false);
  assert.ok(result.matches[0].card?.participants.every((participant) => participant.score === null));
});

test("configured nomination activity deducts drafts, releases rejected quotas and excludes other activities", () => {
  const result = sidebar({
    navigation: { resultsGroupId: group.id, nominationContestId: "1" },
    contests: [
      contest("1", { status: "nominating", max_nominations_per_user: 3 }),
      contest("2", { status: "nominating", max_nominations_per_user: 2, group_id: null }),
      contest("past", { status: "closed" }),
    ],
    nominations: [
      { contest_id: "1", status: "pending" },
      { contest_id: "1", status: "draft" },
      { contest_id: "1", status: "rejected" },
      { contest_id: "2", status: "approved" },
      { contest_id: "past", status: "approved" },
      { contest_id: "archived", status: "approved" },
    ],
  });
  assert.equal(result.matches.length, 0);
  assert.equal(result.remainingNominationCount, 1);
  assert.equal(result.nominatedCount, 2);
  assert.equal(result.canNominate, true);
  assert.equal(result.nominationActionHref, "/contests/1/nominate");
  assert.equal(result.nominationHistoryHref, "/contests/1/my-nominations");
  const historyOnly = sidebar({
    navigation: { resultsGroupId: group.id, nominationContestId: "archived" },
    contests: [], nominations: [{ contest_id: "archived", status: "approved" }],
  });
  assert.equal(historyOnly.nominatedCount, 1);
  assert.equal(historyOnly.remainingNominationCount, 0);
  assert.equal(historyOnly.canNominate, false);
  assert.equal(historyOnly.nominationHistoryHref, "/contests/archived/my-nominations");
});

test("remaining nomination quota excludes inaccessible groups and exhausted activities", () => {
  const result = sidebar({
    navigation: { resultsGroupId: group.id, nominationContestId: "open" },
    contests: [
      contest("full", { status: "nominating", max_nominations_per_user: 1 }),
      contest("restricted", { status: "nominating", group_id: "restricted", max_nominations_per_user: null }),
      contest("missing", { status: "nominating", group_id: "missing" }),
      contest("open", { status: "nominating", group_id: null, max_nominations_per_user: 2 }),
    ],
    groups: [group, { ...group, id: "restricted", access_mode: "restricted" }],
    nominations: [{ contest_id: "full", status: "pending" }, { contest_id: "full", status: "approved" }],
  });
  assert.equal(result.remainingNominationCount, 2);
  assert.equal(result.nominationActionHref, "/contests/open/nominate");
  assert.equal(sidebar({
    navigation: { resultsGroupId: group.id, nominationContestId: "1" },
    contests: [contest("1", { status: "nominating" })],
    groups: [{ ...group, access_mode: "restricted" }],
    allowedGroupIds: [group.id],
  }).remainingNominationCount, 3);
});

test("unlimited and admin-only nominations follow the existing submission rules", () => {
  const navigation = { resultsGroupId: group.id, nominationContestId: "1" };
  assert.equal(sidebar({ navigation, contests: [contest("1", { status: "nominating", max_nominations_per_user: null })] }).remainingNominationCount, null);
  const adminOnly = [contest("1", { status: "admin_nominating", max_nominations_per_user: 1 })];
  assert.equal(sidebar({ navigation, contests: adminOnly }).remainingNominationCount, 0);
  assert.equal(sidebar({ navigation, contests: adminOnly }).canNominate, false);
  assert.equal(sidebar({ navigation, contests: adminOnly, isAdmin: true }).remainingNominationCount, null);
  assert.equal(sidebar({ navigation, contests: adminOnly, isAdmin: true }).canNominate, true);
  assert.equal(sidebar({ navigation, contests: [contest("1", { status: "closed" })], isAdmin: true }).remainingNominationCount, 0);
});

test("guests retain concrete action destinations and all three actions return there after login", () => {
  const result = sidebar({
    signedIn: false,
    contests: [contest("vote"), contest("nominate", { status: "nominating", group_id: null })],
    nominations: [{ contest_id: "nominate", status: "pending" }],
  });
  assert.equal(result.remainingNominationCount, 0);
  assert.equal(result.nominatedCount, 0);
  assert.equal(result.actionHref, "/groups/group/vote");
  assert.equal(result.nominationActionHref, "/contests/nominate/nominate");
  assert.equal(result.nominationHistoryHref, "/contests/nominate/my-nominations");
  assert.equal(result.canNominate, true);
  assert.ok(result.actionHref);
  assert.ok(result.nominationActionHref);
  for (const target of [result.actionHref, result.nominationActionHref, result.nominationHistoryHref!, "/#public-contests"]) {
    const href = homepageActionHref(false, target);
    const url = new URL(href, "https://example.com");
    assert.equal(url.pathname, "/login");
    assert.equal(url.searchParams.get("returnTo"), target);
    assert.equal(homepageActionHref(true, target), target);
  }
  assert.equal(homepageActionHref(false, "#public-contests"), "/login?returnTo=%2F%23public-contests");
});

test("a failed vote read does not hide nominations and a failed nomination read does not hide votes", () => {
  const contests = [contest("vote"), contest("nominate", { status: "nominating" })];
  const nominations = [{ contest_id: "nominate", status: "pending" as const }];
  const voteFailure = sidebar({ contests, nominations, personalDataAvailable: false });
  assert.equal(voteFailure.eligibleCount, 0);
  assert.equal(voteFailure.remainingNominationCount, 2);
  assert.equal(voteFailure.nominatedCount, 1);
  const nominationFailure = sidebar({ contests, nominations, nominationDataAvailable: false });
  assert.equal(nominationFailure.eligibleCount, 1);
  assert.equal(nominationFailure.remainingNominationCount, 0);
  assert.equal(nominationFailure.nominatedCount, 0);
  assert.equal(nominationFailure.nominationActionHref, "/contests/nominate/nominate");
  assert.equal(nominationFailure.nominationHistoryHref, "/contests/nominate/my-nominations");
  assert.equal(nominationFailure.canNominate, false);
});

test("exhausting the configured activity hides new nominations even when other activities still have places", () => {
  const result = sidebar({
    contests: [
      contest("nominate", { status: "nominating", max_nominations_per_user: 2 }),
      contest("other", { status: "nominating", max_nominations_per_user: null }),
    ],
    nominations: [
      { contest_id: "nominate", status: "pending" },
      { contest_id: "nominate", status: "draft" },
      { contest_id: "other", status: "approved" },
    ],
  });
  assert.equal(result.remainingNominationCount, 0);
  assert.equal(result.nominatedCount, 1);
  assert.equal(result.canNominate, false);
  assert.equal(result.nominationHistoryHref, "/contests/nominate/my-nominations");
});

test("leaving the nomination phase hides creation while keeping scoped submitted history available", () => {
  for (const status of ["draft", "waiting", "voting", "closed", "published"] as const) {
    const result = sidebar({
      contests: [contest("nominate", { status, max_nominations_per_user: null })],
      nominations: [
        { contest_id: "nominate", status: "approved" },
        { contest_id: "nominate", status: "rejected" },
      ],
    });
    assert.equal(result.canNominate, false, status);
    assert.equal(result.remainingNominationCount, 0, status);
    assert.equal(result.nominatedCount, 2, status);
    assert.equal(result.nominationHistoryHref, "/contests/nominate/my-nominations", status);
  }
});

test("rejected nominations restore a place without disappearing from the configured activity history", () => {
  const result = sidebar({
    contests: [contest("nominate", { status: "nominating", max_nominations_per_user: 1 })],
    nominations: [{ contest_id: "nominate", status: "rejected" }],
  });
  assert.equal(result.canNominate, true);
  assert.equal(result.remainingNominationCount, 1);
  assert.equal(result.nominatedCount, 1);
});

test("unknown history and lost group permission hide creation but retain the configured history destination", () => {
  const contests = [contest("nominate", { status: "nominating" })];
  for (const input of [
    { contests, nominationDataAvailable: false },
    { contests, groups: [{ ...group, access_mode: "restricted" as const }] },
    { contests: [] },
  ]) {
    const result = sidebar(input);
    assert.equal(result.canNominate, false);
    assert.equal(result.nominationHistoryHref, "/contests/nominate/my-nominations");
  }
});

test("guest creation respects activity status and a zero limit while both links keep their configured destination", () => {
  for (const limit of [0, 2, null]) {
    const result = sidebar({
      signedIn: false,
      contests: [contest("nominate", { status: "nominating", max_nominations_per_user: limit })],
    });
    assert.equal(result.canNominate, limit !== 0);
    assert.equal(result.nominationHistoryHref, "/contests/nominate/my-nominations");
  }
});

test("homepage actions always use administrator settings despite other pending votes and nominations", () => {
  const result = sidebar({
    contests: [contest("unrelated", { group_id: null }), contest("open", { status: "nominating", group_id: null })],
    navigation: { resultsGroupId: "configured-group", nominationContestId: "configured-contest" },
  });
  assert.equal(result.pendingCount, 1);
  assert.equal(result.actionHref, "/groups/configured-group/vote");
  assert.equal(result.nominationActionHref, "/contests/configured-contest/nominate");
  assert.equal(result.canSupplementLoveVote, false);
});

test("disabled administrator destinations do not silently switch to another activity", () => {
  const result = supplement({ navigation: { resultsGroupId: null, nominationContestId: null } });
  assert.equal(result.actionHref, null);
  assert.equal(result.nominationActionHref, null);
  assert.equal(result.nominationHistoryHref, null);
  assert.equal(result.canNominate, false);
  assert.equal(result.canSupplementLoveVote, false);
});

test("an independently configured results activity keeps the homepage vote action on that activity", () => {
  const result = sidebar({
    contests: [contest("unrelated", { group_id: null })],
    navigation: { resultsGroupId: null, resultsContestId: "configured-contest", nominationContestId: null },
  });
  assert.equal(result.actionHref, "/contests/configured-contest/vote");
  assert.equal(result.canSupplementLoveVote, false);
});

test("an eligible love supplement replaces the vote action even when another contest remains unvoted", () => {
  const result = supplement();
  assert.equal(result.pendingCount, 1);
  assert.equal(result.canSupplementLoveVote, true);
  assert.equal(result.actionHref, "/groups/group/vote");
  assert.equal(supplement({ votes: ordinaryVotes("1", "2") }).canSupplementLoveVote, true);
});

test("love supplement eligibility requires a selected active candidate without a previous love vote", () => {
  const alreadyLoved = { group_id: group.id, vote_id: "vote-1", candidate_id: "candidate-1" };
  for (const [voteType, payload] of [
    ["single", { candidateId: "candidate-1" }],
    ["multiple", { candidateIds: ["candidate-1", "candidate-2"] }],
    ["ranked", { ranking: ["candidate-1", "candidate-2"] }],
  ] as const) {
    const votes = [{ id: "vote-1", contest_id: "1", payload: JSON.parse(JSON.stringify(payload)) }];
    const input = { contests: [contest("1", { vote_type: voteType })], votes };
    assert.equal(supplement(input).canSupplementLoveVote, true, voteType);
    assert.equal(supplement({ ...input, loveAllocations: [alreadyLoved] }).canSupplementLoveVote, false, voteType);
    if (voteType !== "single") {
      assert.equal(supplement({
        ...input,
        activeCandidates: [{ id: "candidate-2", contest_id: "1" }],
        loveAllocations: [alreadyLoved],
      }).canSupplementLoveVote, true, `${voteType}: another chosen candidate remains eligible`);
    }
  }
  assert.equal(supplement({ activeCandidates: [] }).canSupplementLoveVote, false);
  assert.equal(supplement({ activeCandidates: [{ id: "not-selected", contest_id: "1" }] }).canSupplementLoveVote, false);
  assert.equal(supplement({ activeCandidates: [{ id: "candidate-1", contest_id: "2" }] }).canSupplementLoveVote, false);
});

test("love supplement does not appear for exhausted, disabled, closed, unknown or inaccessible ballots", () => {
  const cases: Array<[string, Partial<Parameters<typeof buildHomepageSidebarData>[0]>]> = [
    ["guest", { signedIn: false }],
    ["unavailable voting history", { personalDataAvailable: false }],
    ["unavailable love history", { loveDataAvailable: false }],
    ["no ordinary vote", { votes: [] }],
    ["invalid ordinary payload", { votes: [{ id: "vote-1", contest_id: "1", payload: null }] }],
    ["no quota", { groups: [{ ...group, love_vote_quota: 0 }] }],
    ["no love weighting", { groups: [{ ...group, love_vote_weight: 1 }] }],
    ["quota used in previous rounds", { loveAllocations: loveAllocations(group.id, group.id, group.id) }],
    ["love disabled for contest", { contests: [contest("1", { love_vote_enabled: false })] }],
    ["closed contest", { contests: [contest("1", { status: "closed" })] }],
    ["ended contest", { contests: [contest("1", { voting_ends_at: new Date(now).toISOString() })] }],
    ["future contest", { contests: [contest("1", { voting_starts_at: new Date(now + 1).toISOString() })] }],
    ["restricted group", { groups: [{ ...group, access_mode: "restricted" }] }],
    ["missing group", { groups: [] }],
    ["eligible vote belongs to another configured group", { navigation: { resultsGroupId: "other", nominationContestId: "nominate" } }],
  ];
  for (const [name, input] of cases) {
    assert.equal(supplement(input).canSupplementLoveVote, false, name);
  }
  const restricted = [{ ...group, access_mode: "restricted" as const }];
  assert.equal(supplement({ groups: restricted, allowedGroupIds: [group.id] }).canSupplementLoveVote, true);
  assert.equal(supplement({ groups: restricted, isAdmin: true }).canSupplementLoveVote, true);
});
