import type { CharacterSearchResponse, CharacterSearchSource } from "./types";

const CACHE_TTL_MS = 2 * 60 * 1000;
const MAX_CACHE_ENTRIES = 16;

export function createCharacterSearchClient({ fetcher = fetch, now = Date.now }: {
  fetcher?: typeof fetch;
  now?: () => number;
} = {}) {
  const cache = new Map<string, { result: CharacterSearchResponse; expiresAt: number }>();

  return async function search(query: string, source: CharacterSearchSource, page: number, signal: AbortSignal): Promise<CharacterSearchResponse> {
    if (signal.aborted) throw new DOMException("Search cancelled", "AbortError");
    const key = JSON.stringify([query.trim(), source, page]);
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now()) {
      cache.delete(key);
      cache.set(key, cached);
      return cached.result;
    }
    cache.delete(key);

    const params = new URLSearchParams({ q: query.trim(), source, page: String(page) });
    const response = await fetcher(`/api/characters/search?${params}`, { signal });
    let result = await response.json() as CharacterSearchResponse & { error?: string };
    if (!response.ok) throw new Error(result.error || "搜索失败，请稍后重试。");
    if (!Array.isArray(result.items) || !Array.isArray(result.errors) || typeof result.hasMore !== "boolean") {
      throw new Error("搜索结果无效，请稍后重试。");
    }
    if (signal.aborted) throw new DOMException("Search cancelled", "AbortError");
    if (result.errors.some((error) => error.source === "anilist")) {
      const { retryAniListSearchInBrowser } = await import("./browser");
      result = await retryAniListSearchInBrowser(query, page, result, signal, fetcher);
    }
    if (signal.aborted) throw new DOMException("Search cancelled", "AbortError");

    // Public character metadata only; no persistent storage, failures or
    // incomplete results. Keep both the memory usage and staleness bounded.
    if (!result.errors.length) {
      for (const [entryKey, entry] of cache) if (entry.expiresAt <= now()) cache.delete(entryKey);
      cache.set(key, { result, expiresAt: now() + CACHE_TTL_MS });
      while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
    }
    return result;
  };
}

export const searchCharacterImages = createCharacterSearchClient();
