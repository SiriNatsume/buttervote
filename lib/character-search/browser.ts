import { searchCharacters } from "./providers";
import { deduplicateCharacterItems, interleaveCharacterItems, type CharacterSearchResponse } from "./types";

// AniList can reject Cloudflare's outbound IPs while accepting the user's
// browser. Retry its public API without forwarding any site credentials.
export async function retryAniListSearchInBrowser(
  query: string,
  page: number,
  result: CharacterSearchResponse,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<CharacterSearchResponse> {
  if (!result.errors.some((error) => error.source === "anilist") || signal.aborted) return result;

  const direct = await searchCharacters(query, "anilist", page, {
    // The authenticated API already expanded these names. Reusing them avoids
    // downloading and initializing OpenCC dictionaries in modern clients.
    queryVariants: result.queryVariants,
    signal,
    fetcher: (input, init) => fetcher(input, {
      ...init,
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]),
    }),
  });
  if (signal.aborted || (direct.errors.length && !direct.items.length)) return result;
  return {
    items: interleaveCharacterItems(deduplicateCharacterItems([...result.items, ...direct.items])),
    hasMore: result.hasMore || direct.hasMore,
    errors: [...result.errors.filter((error) => error.source !== "anilist"), ...direct.errors],
    queryVariants: direct.queryVariants,
  };
}
