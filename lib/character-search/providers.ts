import { z } from "zod";
import { isCharacterImageUrl } from "./image";
import { getCharacterQueryVariants } from "./query-variants";
import {
  CHARACTER_SOURCES,
  deduplicateCharacterItems,
  interleaveCharacterItems,
  type CharacterSearchItem,
  type CharacterSearchResponse,
  type CharacterSearchSource,
  type CharacterSource,
} from "./types";

const PAGE_SIZE = 12;
export const characterSearchSchema = z.object({
  query: z.string().trim().min(1, "请输入角色名。").max(100, "搜索关键词不能超过 100 字。"),
  source: z.enum(["all", ...CHARACTER_SOURCES]).default("all"),
  page: z.coerce.number().int().min(1).max(20).default(1),
});

const imageSchema = z.object({
  large: z.string().nullish(),
  medium: z.string().nullish(),
  small: z.string().nullish(),
}).nullish();

const bangumiSchema = z.object({
  total: z.number(),
  data: z.array(z.object({
    id: z.number(), name: z.string(), images: imageSchema,
    infobox: z.array(z.object({ key: z.string(), value: z.unknown() })).optional(),
  })),
});

const anilistSchema = z.object({
  data: z.object({ Page: z.object({
    pageInfo: z.object({ hasNextPage: z.boolean() }),
    characters: z.array(z.object({
      id: z.number(),
      name: z.object({ full: z.string().nullish(), native: z.string().nullish(), alternative: z.array(z.string()).nullish() }),
      image: imageSchema,
      media: z.object({ nodes: z.array(z.object({
        title: z.object({ native: z.string().nullish(), romaji: z.string().nullish() }),
      })) }).nullish(),
    })),
  }) }),
});

const vndbSchema = z.object({
  more: z.boolean(),
  results: z.array(z.object({
    id: z.string().regex(/^c\d+$/), name: z.string(), original: z.string().nullish(),
    image: z.object({ url: z.string() }).nullish(),
    vns: z.array(z.object({ title: z.string(), alttitle: z.string().nullish() })).optional(),
  })),
});

const ANILIST_QUERY = `query CharacterSearch($search: String!, $page: Int!, $perPage: Int!) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { hasNextPage }
    characters(search: $search, sort: SEARCH_MATCH) {
      id name { full native alternative } image { large medium }
      media(perPage: 2, sort: POPULARITY_DESC) { nodes { title { native romaji } } }
    }
  }
}`;

type SearchOptions = {
  fetcher?: typeof fetch;
  bangumiUserAgent?: string;
  bangumiAccessToken?: string;
  queryVariants?: readonly string[];
  signal?: AbortSignal;
};

class ProviderError extends Error {}

async function requestJson(url: string, body: unknown, options: SearchOptions, headers?: Record<string, string>): Promise<unknown> {
  if (options.signal?.aborted) throw new DOMException("Search cancelled", "AbortError");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await (options.fetcher ?? fetch)(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
      body: JSON.stringify(body),
      signal: options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal,
      next: { revalidate: 300 },
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429) throw new ProviderError("搜索较频繁，请稍后重试。");
      if (response.status === 401) throw new ProviderError("资料库认证失败，请联系管理员检查配置。");
      throw new ProviderError("资料库暂时无法连接，请稍后重试。");
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function validItems(source: CharacterSource, items: CharacterSearchItem[]): CharacterSearchItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!item.name.trim() || !isCharacterImageUrl(source, item.imageUrl) || seen.has(item.id)) return false;
    seen.add(item.id);
    if (!isCharacterImageUrl(source, item.thumbnailUrl)) item.thumbnailUrl = item.imageUrl;
    return true;
  });
}

function normalizeName(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

export async function searchCharacterSource(source: CharacterSource, query: string, page: number, options: SearchOptions = {}) {
  let items: CharacterSearchItem[];
  let hasMore: boolean;
  if (source === "bangumi") {
    const raw = await requestJson(`https://api.bgm.tv/v0/search/characters?limit=${PAGE_SIZE}&offset=${(page - 1) * PAGE_SIZE}`,
      { keyword: query }, options, {
        "User-Agent": options.bangumiUserAgent || "ButterVote/0.1 (character search)",
        ...(options.bangumiAccessToken ? { Authorization: `Bearer ${options.bangumiAccessToken}` } : {}),
      });
    const data = bangumiSchema.parse(raw);
    items = data.data.map((item) => {
      const chineseName = item.infobox?.find((field) => ["简体中文名", "中文名"].includes(field.key))?.value;
      return {
        id: String(item.id), source, name: typeof chineseName === "string" && chineseName.trim() ? chineseName.trim() : item.name,
        originalName: item.name,
        imageUrl: item.images?.large || item.images?.medium || "",
        thumbnailUrl: item.images?.small || item.images?.medium || item.images?.large || "",
        sourceUrl: `https://bgm.tv/character/${item.id}`, works: [],
      };
    });
    hasMore = data.total > page * PAGE_SIZE;
  } else if (source === "anilist") {
    const raw = await requestJson("https://graphql.anilist.co", {
      query: ANILIST_QUERY, variables: { search: query, page, perPage: PAGE_SIZE },
    }, options);
    // GraphQL may return HTTP 200 with errors and no usable data.
    const data = anilistSchema.parse(raw).data.Page;
    // AniList can discard unsupported non-Latin keywords and return a default
    // popular-character list. Do not mistake that fallback for search matches.
    const characters = /[a-z0-9]/i.test(query) ? data.characters : data.characters.filter((item) =>
      [item.name.full, item.name.native, ...(item.name.alternative ?? [])].some((name) => name && normalizeName(name).includes(normalizeName(query))),
    );
    items = characters.map((item) => ({
      id: String(item.id), source,
      name: item.name.native || item.name.full || "",
      originalName: item.name.full || "",
      imageUrl: item.image?.large || item.image?.medium || "",
      thumbnailUrl: item.image?.medium || item.image?.large || "",
      sourceUrl: `https://anilist.co/character/${item.id}`,
      works: [...new Set(item.media?.nodes.map((media) => media.title.native || media.title.romaji || "").filter(Boolean) ?? [])],
    }));
    hasMore = characters.length > 0 && data.pageInfo.hasNextPage;
  } else {
    const raw = await requestJson("https://api.vndb.org/kana/character", {
      filters: ["search", "=", query],
      fields: "name,original,image.url,vns.title,vns.alttitle",
      sort: "searchrank", results: PAGE_SIZE, page,
    }, options);
    const data = vndbSchema.parse(raw);
    items = data.results.map((item) => ({
      id: item.id, source, name: item.original || item.name, originalName: item.name,
      imageUrl: item.image?.url || "", thumbnailUrl: item.image?.url || "",
      sourceUrl: `https://vndb.org/${item.id}`,
      works: [...new Set(item.vns?.map((vn) => vn.alttitle || vn.title) ?? [])].slice(0, 2),
    }));
    hasMore = data.more;
  }
  const keyword = normalizeName(query);
  const exactMatch = (item: CharacterSearchItem) => [item.name, item.originalName].some((name) => normalizeName(name) === keyword);
  return { items: validItems(source, items).sort((a, b) => Number(exactMatch(b)) - Number(exactMatch(a))), hasMore };
}

export async function searchCharacters(
  query: string,
  source: CharacterSearchSource,
  page: number,
  options: SearchOptions = {},
): Promise<CharacterSearchResponse> {
  const sources = source === "all" ? CHARACTER_SOURCES : [source];
  const queries = options.queryVariants
    ? [...new Set(options.queryVariants)].slice(0, 3)
    : await getCharacterQueryVariants(query);
  const results = await Promise.all(sources.map(async (provider) => ({
    source: provider,
    variants: await Promise.allSettled(queries.map((keyword) => searchCharacterSource(provider, keyword, page, options))),
  })));
  const response: CharacterSearchResponse = { items: [], hasMore: false, errors: [], queryVariants: queries };
  const exactNames = new Set(queries.map(normalizeName));
  const exactMatch = (item: CharacterSearchItem) => [item.name, item.originalName].some((name) => exactNames.has(normalizeName(name)));
  for (const result of results) {
    const items: CharacterSearchItem[] = [];
    const failures: unknown[] = [];
    let succeeded = false;
    for (const variant of result.variants) {
      if (variant.status === "fulfilled") {
        succeeded = true;
        items.push(...variant.value.items);
        response.hasMore ||= variant.value.hasMore;
      } else failures.push(variant.reason);
    }
    response.items.push(...deduplicateCharacterItems(items).sort((a, b) => Number(exactMatch(b)) - Number(exactMatch(a))));
    if (failures.length) {
      const failure = failures.find((error) => error instanceof ProviderError);
      const message = failure instanceof ProviderError ? failure.message : "资料库暂时不可用，请稍后重试。";
      response.errors.push({
        source: result.source,
        message: succeeded ? `部分结果未能加载：${message}` : message,
      });
    }
  }
  // Keep each provider visible in combined searches; names are not unique
  // across franchises, so do not merge different sources by name alone.
  return { ...response, items: interleaveCharacterItems(response.items) };
}
