import assert from "node:assert/strict";
import {
  entryOutcomeIsHiddenInMatch,
  hiddenOutcomeRoundByEntry,
  inheritedCandidateIsPublic,
  latestBracketVersion,
  resolveBracketResultVisibility,
} from "../lib/tournament-bracket-visibility.ts";

const matches = [
  {
    id: "qf-1",
    round: "quarterfinal",
    left_entry_id: "entry-a",
    right_entry_id: "entry-b",
    winner_entry_id: "entry-a",
    loser_entry_id: "entry-b",
  },
  {
    id: "sf-1",
    round: "semifinal",
    left_entry_id: "entry-a",
    right_entry_id: "entry-c",
    winner_entry_id: "entry-a",
    loser_entry_id: "entry-c",
  },
] as const;
const resultVisibleByMatch = new Map([
  ["qf-1", false],
  ["sf-1", false],
]);
const hiddenRoundByEntry = hiddenOutcomeRoundByEntry(
  matches,
  resultVisibleByMatch,
);

assert.equal(
  entryOutcomeIsHiddenInMatch("entry-a", matches[0], hiddenRoundByEntry),
  false,
  "participants remain visible in their unresolved source match",
);
assert.equal(
  entryOutcomeIsHiddenInMatch("entry-a", matches[1], hiddenRoundByEntry),
  true,
  "a hidden quarterfinal winner must stay hidden in the semifinal",
);

const candidates = new Map([
  [
    "next-round",
    {
      id: "next-round",
      contest_id: "semifinal",
      inherited_from_candidate_id: "quarterfinal-source",
    },
  ],
  [
    "quarterfinal-source",
    {
      id: "quarterfinal-source",
      contest_id: "quarterfinal",
      inherited_from_candidate_id: null,
    },
  ],
  [
    "final-round",
    {
      id: "final-round",
      contest_id: "final",
      inherited_from_candidate_id: "next-round",
    },
  ],
]);

assert.equal(
  inheritedCandidateIsPublic("next-round", candidates, new Set()),
  false,
);
assert.equal(
  inheritedCandidateIsPublic(
    "final-round",
    candidates,
    new Set(["quarterfinal", "semifinal"]),
  ),
  true,
);
assert.equal(
  inheritedCandidateIsPublic(
    "final-round",
    candidates,
    new Set(["semifinal"]),
  ),
  false,
  "every contest in an inherited candidate lineage must expose full results",
);

const cyclicCandidates = new Map([
  [
    "cycle-a",
    {
      id: "cycle-a",
      contest_id: "contest-a",
      inherited_from_candidate_id: "cycle-b",
    },
  ],
  [
    "cycle-b",
    {
      id: "cycle-b",
      contest_id: "contest-b",
      inherited_from_candidate_id: "cycle-a",
    },
  ],
]);
assert.equal(
  inheritedCandidateIsPublic(
    "cycle-a",
    cyclicCandidates,
    new Set(["contest-a", "contest-b"]),
  ),
  false,
  "invalid inheritance cycles fail closed",
);

const dependencyMatches = [
  ...matches,
  {
    id: "final-1",
    round: "final",
    left_entry_id: "entry-a",
    right_entry_id: "entry-d",
    winner_entry_id: "entry-d",
    loser_entry_id: "entry-a",
  },
] as const;
const dependencyVisibility = resolveBracketResultVisibility(
  dependencyMatches,
  new Map([
    ["qf-1", false],
    ["sf-1", true],
    ["final-1", true],
  ]),
  (entryId, match, hiddenRounds) =>
    !entryOutcomeIsHiddenInMatch(entryId, match, hiddenRounds),
);

assert.equal(dependencyVisibility.resultVisibleByMatch.get("qf-1"), false);
assert.equal(
  dependencyVisibility.resultVisibleByMatch.get("sf-1"),
  false,
  "a match cannot expose its result while an upstream participant is hidden",
);
assert.equal(
  dependencyVisibility.resultVisibleByMatch.get("final-1"),
  false,
  "hidden dependencies must propagate through every later round",
);

assert.equal(
  latestBracketVersion([
    "2026-07-15T00:00:00.000Z",
    "2026-07-15T00:01:00.000Z",
    null,
  ]),
  String(Date.parse("2026-07-15T00:01:00.000Z")),
);

console.log("tournament bracket visibility tests passed");
