import assert from "node:assert/strict";
import test from "node:test";
import { formatRelativeContestTime } from "../components/relative-contest-time";
import { formatContestOrdinal } from "../lib/contest-rank-styles";
import {
  groupContestMatchesQuery,
  partitionGroupHomepageContests,
  type GroupHomepageContest,
} from "../lib/group-homepage";

function contest(
  title: string,
  status: GroupHomepageContest["status"],
  overrides: Partial<GroupHomepageContest> = {},
): GroupHomepageContest {
  return {
    id: `${title}-${status}`,
    title,
    description: null,
    imageUrl: null,
    status,
    voteType: "single",
    votingStartsAt: null,
    votingEndsAt: null,
    updatedAt: "2026-07-01T00:00:00Z",
    resultVisible: false,
    breakdownVisible: false,
    loveVoteWeight: null,
    participants: [],
    searchText: title.normalize("NFKC").toLocaleLowerCase("zh-CN"),
    ...overrides,
  };
}

test("group homepage partitions statuses and uses natural Chinese title order", () => {
  const result = partitionGroupHomepageContests([
    contest("比赛 10", "voting"),
    contest("比赛 2", "nominating"),
    contest("后台提名", "admin_nominating"),
    contest("比赛 3", "waiting"),
    contest("草稿", "draft"),
  ]);
  assert.deepEqual(result.ongoing.map((item) => item.title), ["比赛 2", "比赛 10"]);
  assert.deepEqual(result.upcoming.map((item) => item.title), ["比赛 3"]);
  assert.equal(result.recent.length, 0);
});

test("recent contests prefer scheduled end time and fall back to updated time", () => {
  const result = partitionGroupHomepageContests([
    contest("Older", "published", {
      votingEndsAt: "2026-07-02T00:00:00Z",
      updatedAt: "2026-07-10T00:00:00Z",
    }),
    contest("Fallback", "closed", { updatedAt: "2026-07-04T00:00:00Z" }),
    contest("Newest", "published", {
      votingEndsAt: "2026-07-05T00:00:00Z",
    }),
  ]);
  assert.deepEqual(result.recent.map((item) => item.title), [
    "Newest",
    "Fallback",
    "Older",
  ]);
});

test("recent result search matches normalized hidden carousel candidate names", () => {
  const value = contest("Final", "published", {
    searchText: "final mock contestant 02 测试选手",
  });
  assert.equal(groupContestMatchesQuery(value, "ＭＯＣＫ contestant 02"), true);
  assert.equal(groupContestMatchesQuery(value, "测试选手"), true);
  assert.equal(groupContestMatchesQuery(value, "not present"), false);
});

test("contest relative time formats past and future units", () => {
  const now = Date.parse("2026-07-17T00:00:00Z");
  assert.equal(
    formatRelativeContestTime("2026-07-19T00:00:00Z", now, "starts"),
    "2天后开始",
  );
  assert.equal(
    formatRelativeContestTime("2026-07-17T02:00:00Z", now, "ends"),
    "2小时后结束",
  );
  assert.equal(
    formatRelativeContestTime("2026-07-16T22:00:00Z", now, "ended"),
    "2小时前结束",
  );
  assert.equal(
    formatRelativeContestTime("2026-07-16T23:59:30Z", now, "ended"),
    "刚刚结束",
  );
});

test("contest ranks use English ordinal suffixes", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 11, 12, 13, 21].map(formatContestOrdinal),
    ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st"],
  );
});
