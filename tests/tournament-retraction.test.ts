import assert from "node:assert/strict";
import { getTournamentDrawRetractionTarget } from "../lib/tournament-retraction.ts";

const tournamentId = "tournament";

function log(
  id: string,
  kind: string,
  createdAt: string,
  stageIds: string[],
  retractedAt: string | null = null,
) {
  return {
    id,
    tournament_id: tournamentId,
    kind,
    created_at: createdAt,
    output: { stageIds },
    retracted_at: retractedAt,
  };
}

function stage(id: string, contestId: string, sequence: number, kind = "knockout") {
  return {
    id,
    tournament_id: tournamentId,
    kind,
    contest_id: contestId,
    sequence,
  };
}

function contest(
  id: string,
  status: string,
  hasExecutedScheduledTransition = false,
) {
  return {
    id,
    status,
    archived_at: null,
    hasExecutedScheduledTransition,
  };
}

{
  const contestsById = new Map([
    ["source", contest("source", "published")],
    ["target", contest("target", "draft")],
  ]);
  const target = getTournamentDrawRetractionTarget({
    logs: [
      log("draw", "knockout_round_generation", "2026-06-30T12:00:00.000Z", [
        "target-stage",
      ]),
    ],
    stages: [stage("source-stage", "source", 1), stage("target-stage", "target", 2)],
    contestsById,
  });

  assert.equal(target?.log.id, "draw");
  assert.deepEqual(target?.contestIds, ["target"]);
}

{
  const contestsById = new Map([
    ["source", contest("source", "published")],
    ["target", contest("target", "published")],
    ["later", contest("later", "draft")],
  ]);
  const target = getTournamentDrawRetractionTarget({
    logs: [
      log("old", "knockout_draw", "2026-06-30T12:00:00.000Z", ["target-stage"]),
      log("new", "knockout_round_generation", "2026-06-30T13:00:00.000Z", [
        "later-stage",
      ]),
    ],
    stages: [
      stage("source-stage", "source", 1),
      stage("target-stage", "target", 2),
      stage("later-stage", "later", 3),
    ],
    contestsById,
  });

  assert.equal(target?.log.id, "new");
  assert.notEqual(target?.log.id, "old");
}

{
  const contestsById = new Map([
    ["source", contest("source", "published")],
    ["target", contest("target", "waiting")],
  ]);
  const target = getTournamentDrawRetractionTarget({
    logs: [
      log("draw", "knockout_round_generation", "2026-06-30T12:00:00.000Z", [
        "target-stage",
      ]),
    ],
    stages: [stage("source-stage", "source", 1), stage("target-stage", "target", 2)],
    contestsById,
  });

  assert.equal(target, null);
}

{
  const contestsById = new Map([
    ["source", contest("source", "published")],
    ["target", contest("target", "draft", true)],
  ]);
  const target = getTournamentDrawRetractionTarget({
    logs: [
      log("draw", "knockout_round_generation", "2026-06-30T12:00:00.000Z", [
        "target-stage",
      ]),
    ],
    stages: [stage("source-stage", "source", 1), stage("target-stage", "target", 2)],
    contestsById,
  });

  assert.equal(target, null);
}

console.log("tournament retraction tests passed");
