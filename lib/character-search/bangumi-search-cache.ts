import type { CharacterSearchItem } from "./types";

export type BangumiQueryResult = { items: CharacterSearchItem[]; hasMore: boolean };

export function createBangumiSearchCache(now: () => number = Date.now) {
  const entries = new Map<string, { values: BangumiQueryResult[]; expiresAt: number }>();
  return {
    get(key: string) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      entries.delete(key);
      if (entry.expiresAt <= now()) return undefined;
      entries.set(key, entry);
      return entry.values;
    },
    set(key: string, values: BangumiQueryResult[]) {
      for (const [entryKey, entry] of entries) if (entry.expiresAt <= now()) entries.delete(entryKey);
      entries.delete(key);
      entries.set(key, { values, expiresAt: now() + 60000 });
      while (entries.size > 32) entries.delete(entries.keys().next().value!);
    },
  };
}

export const bangumiSearchCache = createBangumiSearchCache();
