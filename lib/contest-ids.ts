export function canonicalContestIds(ids: readonly string[]) {
  return [...new Set(ids.map((id) => id.toLowerCase()))];
}
