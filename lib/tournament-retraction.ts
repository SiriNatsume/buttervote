export const RETRACTABLE_DRAW_KINDS = [
  "preliminary_draw",
  "preliminary_tiebreaker_generation",
  "knockout_draw",
  "knockout_round_generation",
] as const;

export type RetractableDrawKind = (typeof RETRACTABLE_DRAW_KINDS)[number];

export type DrawRetractionLog = {
  id: string;
  tournament_id: string;
  kind: string;
  created_at: string;
  output: unknown;
  retracted_at?: string | null;
};

export type DrawRetractionStage = {
  id: string;
  tournament_id: string;
  kind: string;
  contest_id: string | null;
  sequence: number;
};

export type DrawRetractionContest = {
  id: string;
  status: string;
  archived_at?: string | null;
  hasExecutedScheduledTransition?: boolean;
};

export type DrawRetractionTarget = {
  log: DrawRetractionLog & { kind: RetractableDrawKind };
  stageIds: string[];
  contestIds: string[];
};

const retractableKindSet = new Set<string>(RETRACTABLE_DRAW_KINDS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function compareLogDesc(a: DrawRetractionLog, b: DrawRetractionLog) {
  const timeDiff =
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  return timeDiff || b.id.localeCompare(a.id);
}

function stageIdsFromLog(log: DrawRetractionLog) {
  return isRecord(log.output) ? unique(readStringArray(log.output.stageIds)) : [];
}

export function getTournamentDrawRetractionTarget({
  logs,
  stages,
  contestsById,
}: {
  logs: readonly DrawRetractionLog[];
  stages: readonly DrawRetractionStage[];
  contestsById: ReadonlyMap<string, DrawRetractionContest>;
}): DrawRetractionTarget | null {
  const latestLog = [...logs]
    .filter((log) => !log.retracted_at)
    .sort(compareLogDesc)[0];

  if (!latestLog || !retractableKindSet.has(latestLog.kind)) {
    return null;
  }

  let stageIds = stageIdsFromLog(latestLog);
  if (stageIds.length === 0 && latestLog.kind === "preliminary_draw") {
    stageIds = stages
      .filter((stage) => {
        const contest = stage.contest_id
          ? contestsById.get(stage.contest_id)
          : null;
        return (
          stage.tournament_id === latestLog.tournament_id &&
          stage.kind === "preliminary" &&
          contest &&
          !contest.archived_at
        );
      })
      .sort((a, b) => a.sequence - b.sequence)
      .map((stage) => stage.id);
  }

  stageIds = unique(stageIds);
  if (stageIds.length === 0) {
    return null;
  }

  const stageById = new Map(stages.map((stage) => [stage.id, stage]));
  const targetStages = stageIds
    .map((stageId) => stageById.get(stageId))
    .filter((stage): stage is DrawRetractionStage => Boolean(stage));

  if (targetStages.length !== stageIds.length) {
    return null;
  }

  const contestIds = unique(
    targetStages
      .map((stage) => stage.contest_id)
      .filter((contestId): contestId is string => Boolean(contestId)),
  );

  if (contestIds.length === 0) {
    return null;
  }

  const targetContests = contestIds
    .map((contestId) => contestsById.get(contestId))
    .filter((contest): contest is DrawRetractionContest => Boolean(contest));

  if (
    targetContests.length !== contestIds.length ||
    targetContests.some(
      (contest) =>
        contest.status !== "draft" ||
        Boolean(contest.archived_at) ||
        Boolean(contest.hasExecutedScheduledTransition),
    )
  ) {
    return null;
  }

  const minSequence = Math.min(...targetStages.map((stage) => stage.sequence));
  const targetStageIdSet = new Set(stageIds);
  const previousStages = stages.filter(
    (stage) =>
      stage.tournament_id === latestLog.tournament_id &&
      stage.sequence < minSequence &&
      !targetStageIdSet.has(stage.id),
  );
  const previousStagesComplete = previousStages.every((stage) => {
    const contest = stage.contest_id ? contestsById.get(stage.contest_id) : null;
    return (
      !contest ||
      Boolean(contest.archived_at) ||
      contest.status === "closed" ||
      contest.status === "published"
    );
  });

  if (!previousStagesComplete) {
    return null;
  }

  return {
    log: latestLog as DrawRetractionLog & { kind: RetractableDrawKind },
    stageIds,
    contestIds,
  };
}
