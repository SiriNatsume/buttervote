import type { Json, VoteType } from "@/lib/types";

function isRecord(value: Json): value is Record<string, Json | undefined> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function stringArray(value: Json | undefined) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function selectedCandidateIdsFromVotePayload(
  voteType: VoteType,
  payload: Json,
) {
  if (!isRecord(payload)) {
    return [];
  }

  if (voteType === "single") {
    const candidateId = payload.candidateId;
    return typeof candidateId === "string" && candidateId ? [candidateId] : [];
  }

  if (voteType === "multiple") {
    return uniqueStrings(stringArray(payload.candidateIds));
  }

  return uniqueStrings(stringArray(payload.ranking));
}