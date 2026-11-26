import type { TallyResult } from "./tally";

export function normalizeCandidateName(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("zh-CN");
}

export type ResultSearchItem = {
  rowId: string;
  name: string;
  image_path: string | null;
  rank: number;
  tied: boolean;
  score: number;
};

export function buildResultSearchItems(results: readonly TallyResult[], showImage: boolean): ResultSearchItem[] {
  return results.map((result, index) => ({
    rowId: `result-candidate-${result.candidateId}`,
    name: result.name,
    image_path: showImage ? result.imagePath ?? null : null,
    rank: result.rank,
    tied: results[index - 1]?.rank === result.rank || results[index + 1]?.rank === result.rank,
    score: result.score,
  }));
}
