import { searchCharacters } from "./providers";
import { interleaveCharacterItems, type CharacterSearchResponse } from "./types";

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
    fetcher: (input, init) => fetcher(input, {
      ...init,
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]),
    }),
  });
  if (signal.aborted || direct.errors.length) return result;
  return {
    items: interleaveCharacterItems([...result.items.filter((item) => item.source !== "anilist"), ...direct.items]),
    hasMore: result.hasMore || direct.hasMore,
    errors: result.errors.filter((error) => error.source !== "anilist"),
  };
}
