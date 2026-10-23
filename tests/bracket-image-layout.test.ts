import assert from "node:assert/strict";
import test from "node:test";
import { renderBracketImageLayout } from "../lib/bracket-image/layout.ts";
import type { BracketImageData, BracketImageMatch, BracketImageParticipant, BracketImageRound } from "../lib/bracket-image/types.ts";

const assets = { logoDataUrl: null, participantImages: new Map<string, string>() };

function fixture(): BracketImageData {
  const entries: BracketImageParticipant[] = Array.from({ length: 16 }, (_, i) => ({
    entryId: `entry-${i}`, name: i === 0 ? "尤斯蒂娅·阿斯托利亚" : `角色${i}`,
    imagePath: null, preliminaryGroup: null, preliminaryRank: null,
    screeningRank: i + 1, score: null, isWinner: false,
  }));
  const matches: BracketImageMatch[] = [];
  function match(round: BracketImageRound, slot: number, left: number, right: number) {
    matches.push({
      id: `${round}-${slot}`, round, roundLabel: round, slot,
      contest: { id: `contest-${round}-${slot}`, title: "测试比赛", status: "published" },
      left: { ...entries[left], score: round === "final" ? 19 : 20, isWinner: true },
      right: { ...entries[right], score: round === "final" ? 19 : 10 },
      resultVisible: true, winnerEntryId: entries[left].entryId, loserEntryId: entries[right].entryId,
      scheduledEndsAt: "2026-07-02T20:00:00Z",
    });
  }
  for (let i = 0; i < 8; i++) match("round_of_16", i + 1, i * 2, i * 2 + 1);
  for (let i = 0; i < 4; i++) match("quarterfinal", i + 1, i * 4, i * 4 + 2);
  match("semifinal", 1, 0, 4);
  match("semifinal", 2, 8, 12);
  match("final", 1, 0, 8);
  match("third_place", 1, 4, 12);
  return {
    tournamentId: "tournament", tournamentName: "测试人外杯", groupId: "group", groupName: "测试组",
    generatedAt: "2026-07-19T00:00:00Z", visibilityVersion: String(Date.parse("2026-07-18T04:00:00Z")), matches,
  };
}

test("completed export preserves all matches, highlights only the champion's actual path and explains the final tie", () => {
  const svg = renderBracketImageLayout(fixture(), assets);
  assert.match(svg, /width="2880" height="1620"/);
  assert.equal((svg.match(/data-match=/g) ?? []).length, 16);
  assert.equal((svg.match(/data-champion-route="true"/g) ?? []).length, 3);
  assert.match(svg, /data-champion="revealed"/);
  assert.match(svg, /同分判定：海选排名更高者获胜/);
  assert.match(svg, /07\.03 结束/);
  assert.match(svg, /正赛已结束/);
  assert.doesNotMatch(svg, /样式预览|NaN|Infinity/);
});

test("unpublished final never leaks scores, a champion, win labels or the champion route even with stale winner fields", () => {
  const data = fixture();
  const final = data.matches.find(match => match.round === "final")!;
  final.resultVisible = false;
  final.contest!.status = "closed";
  final.left!.score = 987654;
  final.right!.score = 876543;
  const svg = renderBracketImageLayout(data, assets);
  const finalCard = svg.split('data-match="final:1"')[1].split('data-match="third_place:1"')[0];
  assert.match(svg, /data-champion="pending"/);
  assert.match(svg, /冠军赛 · 结果待公开/);
  assert.doesNotMatch(svg, /data-champion-route="true"|987654|876543|同分判定：/);
  assert.doesNotMatch(finalCard, />胜<|冠军晋级路线/);
});

test("live public scores stay visible without declaring a winner or using incomplete scores to infer a tie", () => {
  const data = fixture();
  const final = data.matches.find(match => match.round === "final")!;
  final.contest!.status = "voting";
  final.left!.score = 123.5;
  final.right!.score = 123.5;
  const svg = renderBracketImageLayout(data, assets);
  assert.match(svg, />123\.5</);
  assert.match(svg, /冠军赛 · 投票中/);
  assert.match(svg, /07\.03 截止/);
  assert.match(svg, /data-champion="pending"/);
  assert.doesNotMatch(svg, /data-champion-route="true"|同分判定：|正赛已结束/);
});

test("incomplete draw has empty future seats and accurate counts instead of fictitious completed rounds", () => {
  const data = fixture();
  data.matches = data.matches.slice(0, 1);
  data.matches[0].resultVisible = false;
  data.matches[0].winnerEntryId = null;
  data.matches[0].contest!.status = "waiting";
  data.matches[0].scheduledEndsAt = null;
  data.matches[0].left!.imagePath = "unavailable.jpg";
  const svg = renderBracketImageLayout(data, assets);
  assert.equal((svg.match(/data-match=/g) ?? []).length, 16);
  assert.match(svg, /2 位已公开角色 · 1 场已生成对阵/);
  assert.match(svg, /等待开始/);
  assert.match(svg, /冠军待定/);
  assert.match(svg, /赛程待定/);
  assert.doesNotMatch(svg, /data-champion-route="true"|>20<|<image/);
});

test("advancement connects to the winner's actual row when the next matchup is reordered", () => {
  const data = fixture();
  const final = data.matches.find(match => match.round === "final")!;
  [final.left, final.right] = [final.right, final.left];
  const svg = renderBracketImageLayout(data, assets);
  const route = svg.match(/<path data-route="semifinal:1-final:1"[^>]+>/)![0];
  assert.match(route, /data-champion-route="true"/);
  assert.match(route, /944 H1240/);
});

test("closed public base scores do not expose a weighted tiebreak explanation", () => {
  const data = fixture();
  data.matches.find(match => match.round === "final")!.contest!.status = "closed";
  assert.doesNotMatch(renderBracketImageLayout(data, assets), /同分判定：/);
});

test("long names and wide scores remain bounded; user text and embedded image references are escaped", () => {
  const data = fixture();
  const match = data.matches[0];
  match.left!.name = '艾莉娜·奥列格芙娜·阿文<script>"&';
  match.left!.score = 1234567.5;
  match.left!.imagePath = "test";
  data.tournamentName = '测试<&"' + "很长的赛事标题".repeat(15);
  const svg = renderBracketImageLayout(data, {
    logoDataUrl: null,
    participantImages: new Map([["test", 'data:image/png;base64,test"&']]),
  });
  assert.doesNotMatch(svg, /<script>|NaN|Infinity/);
  assert.match(svg, /&lt;script&gt;&quot;&amp;/);
  assert.match(svg, /test&quot;&amp;/);
  assert.match(svg, />1234567\.5</);
});

test("an unchanged public version produces a cache-stable image despite a new request timestamp", () => {
  const data = fixture();
  const first = renderBracketImageLayout(data, assets);
  data.generatedAt = "2026-10-23T04:00:00Z";
  assert.equal(renderBracketImageLayout(data, assets), first);
});
