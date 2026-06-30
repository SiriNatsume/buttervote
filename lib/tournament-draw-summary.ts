import type { TournamentStageKind } from "@/lib/types";

export type PublicDrawCandidate = {
  name: string;
  score?: number | null;
  rank?: number | null;
  position?: number | null;
  screeningRank?: number | null;
  preliminaryGroup?: string | null;
  preliminaryRank?: number | null;
};

export type PublicDrawGroup = {
  label: string;
  candidates: PublicDrawCandidate[];
};

export type PublicDrawSlot = {
  slot: number;
  fixedGroupWinner?: string | null;
  entryLabel: string | null;
};

export type PublicDrawSummary = {
  id: string;
  kind: string;
  title: string;
  seed: string;
  createdAt: string;
  retractedAt?: string | null;
  retractReason?: string | null;
  methodLabel: string;
  methodDetails: string[];
  ruleSummary: string;
  inputSummary: string[];
  groups?: PublicDrawGroup[];
  slots?: PublicDrawSlot[];
  fallbackNote?: string;
};

type PublicLog = {
  id: string;
  kind: string;
  seed: string;
  input: unknown;
  output: unknown;
  created_at: string;
  retracted_at?: string | null;
  retract_reason?: string | null;
};

const METHOD_LABEL = "Butter Vote 内置 seed 伪随机洗牌";
const METHOD_DETAILS = [
  "算法：seed 伪随机数 + Fisher-Yates 洗牌。",
  "实现：Butter Vote tournament-rules v1。",
  "复现条件：相同输入、相同 seed、相同规则版本会生成相同结果。",
];
const PRELIMINARY_GROUPS = ["A", "B", "C", "D"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readCandidate(value: unknown): PublicDrawCandidate | null {
  if (!isRecord(value)) {
    return null;
  }

  const name = asString(value.name);
  if (!name) {
    return null;
  }

  return {
    name,
    score: asNumber(value.score),
    rank: asNumber(value.rank),
    position: asNumber(value.position),
    screeningRank: asNumber(value.screeningRank),
    preliminaryGroup: asString(value.preliminaryGroup),
    preliminaryRank: asNumber(value.preliminaryRank),
  };
}

function readCandidateList(value: unknown) {
  return asArray(value)
    .map(readCandidate)
    .filter((candidate): candidate is PublicDrawCandidate => Boolean(candidate));
}

function getRecordField(value: unknown, key: string) {
  return isRecord(value) ? value[key] : undefined;
}

function summarizeBoundary(input: Record<string, unknown>) {
  const boundary = getRecordField(input, "boundary");
  if (!isRecord(boundary)) {
    return null;
  }

  const isExtendedByTie = boundary.isExtendedByTie === true;
  const extraAdvancerCount = asNumber(boundary.extraAdvancerCount) ?? 0;
  const score = asNumber(boundary.score);
  if (!isExtendedByTie) {
    return "第 48 名边界没有扩展并列晋级。";
  }

  return `第 48 名边界同分，边界分数 ${score ?? "-"}，额外晋级 ${extraAdvancerCount} 人。`;
}

function buildPreliminaryDrawSummary(log: PublicLog): PublicDrawSummary | null {
  if (!isRecord(log.input) || !isRecord(log.output)) {
    return null;
  }

  const groupsRecord = getRecordField(log.output, "groups");
  if (!isRecord(groupsRecord)) {
    return null;
  }

  const groups = PRELIMINARY_GROUPS.map((group) => ({
    label: `${group} 组`,
    candidates: readCandidateList(groupsRecord[group]),
  })).filter((group) => group.candidates.length > 0);

  if (groups.length === 0) {
    return null;
  }

  const advancerCount = readCandidateList(log.input.advancers).length;
  const pool1Count = readCandidateList(log.input.pool1).length;
  const pool2Count = readCandidateList(log.input.pool2).length;
  const randomizedBoundaryCount = readCandidateList(
    log.input.randomizedPoolBoundary,
  ).length;
  const boundarySummary = summarizeBoundary(log.input);
  const inputSummary = [
    `海选晋级 ${advancerCount || "若干"} 人。`,
    `池 1：${pool1Count || "-"} 人；池 2：${pool2Count || "-"} 人。`,
  ];

  if (boundarySummary) {
    inputSummary.push(boundarySummary);
  }
  if (randomizedBoundaryCount > 0) {
    inputSummary.push(
      `第 8 名附近同票，${randomizedBoundaryCount} 名边界候选使用 seed 随机分池。`,
    );
  }

  return {
    id: log.id,
    kind: log.kind,
    title: "预赛分组抽签结果",
    seed: log.seed,
    createdAt: log.created_at,
    methodLabel: METHOD_LABEL,
    methodDetails: METHOD_DETAILS,
    ruleSummary:
      "海选前 8 名进入池 1，其余晋级者进入池 2；池 1 洗牌后每组 2 名，池 2 洗牌后按 A/B/C/D 均分。",
    inputSummary,
    groups,
  };
}

function buildTiebreakerGenerationSummary(log: PublicLog): PublicDrawSummary | null {
  if (!isRecord(log.input) || !isRecord(log.output)) {
    return null;
  }

  const tiebreakers: PublicDrawGroup[] = [];
  for (const item of asArray(log.output.tiebreakers)) {
    if (!isRecord(item)) {
      continue;
    }

    const group = asString(item.preliminaryGroup) ?? "-";
    const tieKind = item.tieKind === "group_first" ? "小组第一" : "晋级名额";
    const candidates: PublicDrawCandidate[] = [];

    for (const candidate of asArray(item.candidates)) {
      if (!isRecord(candidate)) {
        continue;
      }

      candidates.push({
        name: asString(candidate.name) ?? "相关候选",
        score: asNumber(candidate.score),
      });
    }

    tiebreakers.push({
      label: `${group} 组 ${tieKind}加赛`,
      candidates,
    });
  }

  if (tiebreakers.length === 0) {
    return null;
  }

  return {
    id: log.id,
    kind: log.kind,
    title: "预赛加赛生成结果",
    seed: log.seed,
    createdAt: log.created_at,
    methodLabel: METHOD_LABEL,
    methodDetails: METHOD_DETAILS,
    ruleSummary:
      "只为影响小组第一或晋级名额的同票候选生成 24 小时单选加赛；两类冲突会拆成两个加赛。",
    inputSummary: [`共生成 ${tiebreakers.length} 场加赛。`],
    groups: tiebreakers,
  };
}

function buildKnockoutDrawSummary(log: PublicLog): PublicDrawSummary | null {
  if (!isRecord(log.input) || !isRecord(log.output)) {
    return null;
  }

  const finalists = new Map<string, Record<string, unknown>>();
  for (const finalist of asArray(log.input.finalists)) {
    if (!isRecord(finalist)) {
      continue;
    }
    const entryId = asString(finalist.entryId);
    if (entryId) {
      finalists.set(entryId, finalist);
    }
  }

  const slots = asArray(log.output.slots)
    .map((slot): PublicDrawSlot | null => {
      if (!isRecord(slot)) {
        return null;
      }
      const slotNumber = asNumber(slot.slot);
      if (!slotNumber) {
        return null;
      }

      const entryId = asString(slot.entryId);
      const finalist = entryId ? finalists.get(entryId) : null;
      const name = finalist ? asString(finalist.name) : null;
      const group = finalist ? asString(finalist.preliminaryGroup) : null;
      const preliminaryRank = finalist
        ? asNumber(finalist.preliminaryRank)
        : null;
      const source =
        group && preliminaryRank
          ? `${group} 组第 ${preliminaryRank} 名`
          : group
            ? `${group} 组`
            : null;

      return {
        slot: slotNumber,
        fixedGroupWinner: asString(slot.fixedGroupWinner),
        entryLabel: name && source ? `${name}（${source}）` : name,
      };
    })
    .filter((slot): slot is PublicDrawSlot => Boolean(slot))
    .sort((a, b) => a.slot - b.slot);

  if (slots.length === 0) {
    return null;
  }

  const fixedCount = slots.filter((slot) => slot.fixedGroupWinner).length;
  const randomizedCount = slots.filter(
    (slot) => slot.entryLabel && !slot.fixedGroupWinner,
  ).length;

  return {
    id: log.id,
    kind: log.kind,
    title: "正赛 16 强抽签结果",
    seed: log.seed,
    createdAt: log.created_at,
    methodLabel: METHOD_LABEL,
    methodDetails: METHOD_DETAILS,
    ruleSummary:
      "A/B/C/D 小组第一固定到指定槽位，其余晋级者使用 seed 洗牌后填入剩余槽位。",
    inputSummary: [
      `固定小组第一槽位 ${fixedCount} 个。`,
      `随机填入其他晋级者 ${randomizedCount} 人。`,
    ],
    slots,
  };
}

function buildKnockoutRoundSummary(log: PublicLog): PublicDrawSummary | null {
  if (!isRecord(log.input) || !isRecord(log.output)) {
    return null;
  }

  const matches = asArray(log.output.matches);
  if (matches.length === 0) {
    return null;
  }

  const sourceRound = asString(log.input.sourceRound) ?? "上一轮";

  return {
    id: log.id,
    kind: log.kind,
    title: "正赛后续轮次生成结果",
    seed: log.seed,
    createdAt: log.created_at,
    methodLabel: METHOD_LABEL,
    methodDetails: METHOD_DETAILS,
    ruleSummary:
      "后续轮次根据上一轮胜者或半决赛负者自动生成；若上一轮判定需要随机兜底，会使用同一 seed 派生序列。",
    inputSummary: [`来源轮次：${sourceRound}。`, `生成 ${matches.length} 场比赛。`],
    fallbackNote: "后续轮次通常不是重新抽签，而是按赛程拓扑承接上一轮结果。",
  };
}

export function buildPublicDrawSummary(log: PublicLog): PublicDrawSummary | null {
  let summary: PublicDrawSummary | null;

  switch (log.kind) {
    case "preliminary_draw":
      summary = buildPreliminaryDrawSummary(log);
      break;
    case "preliminary_tiebreaker_generation":
      summary = buildTiebreakerGenerationSummary(log);
      break;
    case "knockout_draw":
      summary = buildKnockoutDrawSummary(log);
      break;
    case "knockout_round_generation":
    case "knockout_finalization":
      summary = buildKnockoutRoundSummary(log);
      break;
    default:
      summary = null;
  }

  if (!summary) {
    return null;
  }

  return {
    ...summary,
    retractedAt: log.retracted_at ?? null,
    retractReason: asString(log.retract_reason),
  };
}

export function buildPublicDrawSummaries(
  logs: readonly PublicLog[],
  stageKind?: TournamentStageKind | null,
) {
  const summaries = logs
    .map(buildPublicDrawSummary)
    .filter((summary): summary is PublicDrawSummary => Boolean(summary));

  if (!stageKind) {
    return summaries;
  }

  const preferredKinds: Partial<Record<TournamentStageKind, string[]>> = {
    screening: ["preliminary_draw"],
    preliminary: ["preliminary_tiebreaker_generation", "knockout_draw"],
    tiebreaker: ["knockout_draw"],
    knockout: ["knockout_draw", "knockout_round_generation", "knockout_finalization"],
  };
  const allowedKinds = preferredKinds[stageKind];
  if (!allowedKinds) {
    return summaries;
  }

  return summaries.filter((summary) => allowedKinds.includes(summary.kind));
}
