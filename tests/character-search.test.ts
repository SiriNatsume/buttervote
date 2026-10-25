import assert from "node:assert/strict";
import test from "node:test";
import { characterSearchSchema, searchCharacters } from "../lib/character-search/providers";
import { fetchCharacterImage, isCharacterImageUrl, MAX_CHARACTER_IMAGE_BYTES } from "../lib/character-search/image";
import { retryAniListSearchInBrowser } from "../lib/character-search/browser";
import type { CharacterSearchResponse } from "../lib/character-search/types";
import { getCharacterQueryVariants } from "../lib/character-search/query-variants";
import { createBangumiSearchCache } from "../lib/character-search/bangumi-search-cache";

const bangumiImage = "https://lain.bgm.tv/pic/crt/l/0c/ac/50406_crt_ZX1jZ.jpg";
const anilistImage = "https://s4.anilist.co/file/anilistcdn/character/large/b63351-0WmsDENpiscp.png";
const vndbImage = "https://t.vndb.org/ch/06/95006.jpg";
const json = (body: unknown) => Response.json(body);

test("combined search handles real provider shapes, preserves same-name characters and interleaves sources", async () => {
  const requests: { url: string; body: Record<string, unknown>; init?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, body: JSON.parse(String(init?.body)), init });
    if (url.includes("api.bgm.tv")) return json({ total: 14, data: [
      { id: 1, name: "ムラサメ", infobox: [{ key: "简体中文名", value: "丛雨" }], images: { large: bangumiImage } },
      { id: 2, name: "另一个角色", images: { large: bangumiImage } },
      { id: 3, name: "无图", images: null },
      { id: 4, name: "危险图片地址", images: { large: "http://127.0.0.1/secret.jpg" } },
    ] });
    if (url.includes("graphql.anilist.co")) return json({ data: { Page: {
      pageInfo: { hasNextPage: false }, characters: [{ id: 5, name: { full: "Murasame", native: "ムラサメ" },
        image: { large: anilistImage }, media: { nodes: [{ title: { native: "作品", romaji: "Work" } }] } }],
    } } });
    return json({ more: true, results: [{ id: "c44770", name: "Murasame", original: "ムラサメ",
      image: { url: vndbImage }, vns: [{ title: "Senren * Banka", alttitle: "千恋＊万花" }] }] });
  };
  const result = await searchCharacters("Murasame", "all", 2, { fetcher, bangumiAccessToken: "test-token" });
  assert.deepEqual(result.items.map((item) => item.source), ["bangumi", "anilist", "vndb", "bangumi"]);
  assert.equal(result.items[0].name, "丛雨");
  assert.equal(result.items[1].name, "ムラサメ");
  assert.deepEqual(result.items[2].works, ["千恋＊万花"]);
  assert.equal(result.hasMore, true);
  assert.deepEqual(result.errors, []);
  assert.match(requests[0].url, /offset=12/);
  assert.equal(new Headers(requests[0].init?.headers).get("Authorization"), "Bearer test-token");
  assert.equal(new Headers(requests[1].init?.headers).get("Authorization"), null);
  assert.equal(new Headers(requests[2].init?.headers).get("Authorization"), null);
  assert.deepEqual(requests[1].body.variables, { search: "Murasame", page: 2, perPage: 12 });
  assert.equal(requests[2].body.page, 2);
  assert.equal(JSON.stringify(result).includes("test-token"), false);
});

test("one failed source does not discard other providers and upstream errors do not leak", async () => {
  const fetcher: typeof fetch = async (input) => {
    if (String(input).includes("api.bgm.tv")) return new Response("private upstream details", { status: 429 });
    if (String(input).includes("graphql.anilist.co")) return json({ errors: [{ message: "private upstream details" }] });
    return json({ more: false, results: [{ id: "c1", name: "Murasame", image: { url: vndbImage } }] });
  };
  const result = await searchCharacters("Murasame", "all", 1, { fetcher });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].source, "vndb");
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0].message, /频繁/);
  assert.equal(JSON.stringify(result).includes("private upstream"), false);
});

test("Bangumi accepts missing or sparse optional metadata without discarding valid characters", async () => {
  const result = await searchCharacters("Setsumi", "bangumi", 1, { fetcher: async (_url, init) => {
    assert.match(new Headers(init?.headers).get("User-Agent")!, /SiriNatsume\/buttervote.*github.com/);
    return json({ total: 2, data: [
      { id: 1, name: "Setsumi", images: { large: bangumiImage }, infobox: null },
      { id: 2, name: "Other", images: { large: bangumiImage }, infobox: [null, { unknown: true }] },
    ] });
  } });
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.errors, []);
});

test("transient upstream failures retry once, while rate limits and Retry-After are respected", async () => {
  let calls = 0;
  const recovered = await searchCharacters("Setsumi", "bangumi", 1, { fetcher: async (_url, init) => {
    calls++;
    if (calls === 1) return new Response(null, { status: 503 });
    assert.equal(init?.cache, "no-store");
    return json({ total: 0, data: [] });
  } });
  assert.equal(calls, 2);
  assert.deepEqual(recovered.errors, []);
  for (const status of [429, 503]) {
    let attempts = 0;
    const result = await searchCharacters("Setsumi", "bangumi", 1, { fetcher: async () => {
      attempts++; return new Response(null, { status, headers: { "Retry-After": "60" } });
    } });
    assert.equal(attempts, 1);
    assert.equal(result.errors.length, 1);
  }
});

test("operator diagnostics classify invalid upstream data without exposing its contents in user errors", async () => {
  const diagnostics: unknown[] = [];
  const result = await searchCharacters("Setsumi", "bangumi", 1, {
    onProviderFailure: (failure) => diagnostics.push(failure),
    fetcher: async () => json({ total: 1, data: [{ id: "invalid-private-body", name: "private text" }] }),
  });
  assert.equal(diagnostics.length, 1);
  assert.match(JSON.stringify(diagnostics), /schema/);
  assert.equal(JSON.stringify(result).includes("private"), false);
});

test("single-source search requests only that provider and distinguishes no results from failures", async () => {
  let requests = 0;
  const result = await searchCharacters("NonexistentCharacter", "vndb", 1, { fetcher: async (input) => {
    requests++;
    assert.equal(String(input), "https://api.vndb.org/kana/character");
    return json({ results: [], more: false });
  } });
  assert.equal(requests, 1);
  assert.deepEqual(result, { items: [], hasMore: false, errors: [], queryVariants: ["NonexistentCharacter"] });
});

test("Chinese names expand in both directions, preserve mixed input and do not duplicate unchanged queries", async () => {
  assert.deepEqual(await getCharacterQueryVariants("  佐仓濑津美  "), ["佐仓濑津美", "佐倉瀨津美"]);
  assert.deepEqual(await getCharacterQueryVariants("佐倉瀨津美"), ["佐倉瀨津美", "佐仓濑津美"]);
  assert.deepEqual(await getCharacterQueryVariants("佐仓瀨津美"), ["佐仓瀨津美", "佐仓濑津美", "佐倉瀨津美"]);
  assert.deepEqual(await getCharacterQueryVariants("木之本"), ["木之本"]);
  assert.deepEqual(await getCharacterQueryVariants("Murasame"), ["Murasame"]);
  assert.deepEqual(await getCharacterQueryVariants("ムラサメ"), ["ムラサメ"]);
  assert.deepEqual(await getCharacterQueryVariants("  "), []);
});

test("simplified search merges both spellings, removes repeated IDs and preserves distinct same-name entries", async () => {
  const queries: string[] = [];
  const result = await searchCharacters("佐仓濑津美", "bangumi", 1, { fetcher: async (_url, init) => {
    const keyword = JSON.parse(String(init?.body)).keyword;
    queries.push(keyword);
    const data = keyword === "佐仓濑津美" ? [
      { id: 1, name: "佐仓濑津美", images: { large: bangumiImage } },
      { id: 2, name: "佐仓濑津美", images: { large: bangumiImage } },
      { id: 9, name: "其他角色", images: { large: bangumiImage } },
    ] : [
      { id: 3, name: "佐倉瀨津美", images: { large: bangumiImage } },
      { id: 1, name: "佐仓濑津美", images: { large: bangumiImage } },
    ];
    return json({ data, total: data.length });
  } });
  assert.deepEqual(queries, ["佐仓濑津美", "佐倉瀨津美"]);
  assert.deepEqual(result.items.map((item) => [item.id, item.name]), [
    ["1", "佐仓濑津美"], ["2", "佐仓濑津美"], ["3", "佐倉瀨津美"], ["9", "其他角色"],
  ]);
  assert.equal(result.hasMore, false);
  assert.deepEqual(result.errors, []);
});

test("every spelling is requested on the same page and later traditional results keep pagination available", async () => {
  const requests: { keyword: string; offset: string | null }[] = [];
  const result = await searchCharacters("佐倉瀨津美", "bangumi", 2, { fetcher: async (url, init) => {
    const keyword = JSON.parse(String(init?.body)).keyword;
    requests.push({ keyword, offset: new URL(String(url)).searchParams.get("offset") });
    return keyword === "佐倉瀨津美"
      ? json({ total: 25, data: [{ id: 20, name: keyword, images: { large: bangumiImage } }] })
      : json({ total: 12, data: [] });
  } });
  assert.deepEqual(requests, [{ keyword: "佐倉瀨津美", offset: "12" }, { keyword: "佐仓濑津美", offset: "12" }]);
  assert.deepEqual(result.items.map((item) => item.id), ["20"]);
  assert.equal(result.hasMore, true);
});

test("one failed spelling preserves the other spelling's results and reports one partial provider error", async () => {
  const result = await searchCharacters("佐仓濑津美", "bangumi", 1, { fetcher: async (_url, init) => {
    const keyword = JSON.parse(String(init?.body)).keyword;
    return keyword === "佐仓濑津美" ? new Response(null, { status: 400 })
      : json({ total: 1, data: [{ id: 3, name: keyword, images: { large: bangumiImage } }] });
  } });
  assert.equal(result.items[0].name, "佐倉瀨津美");
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].source, "bangumi");
  assert.match(result.errors[0].message, /部分结果/);
});

test("all sources receive both Chinese spellings without collapsing IDs from different sources", async () => {
  const requests: Record<string, string[]> = { bangumi: [], anilist: [], vndb: [] };
  const result = await searchCharacters("佐仓濑津美", "all", 1, { fetcher: async (url, init) => {
    const body = JSON.parse(String(init?.body));
    if (String(url).includes("api.bgm.tv")) {
      requests.bangumi.push(body.keyword);
      return json({ total: 1, data: [{ id: 1, name: "佐仓濑津美", images: { large: bangumiImage } }] });
    }
    if (String(url).includes("graphql.anilist.co")) {
      requests.anilist.push(body.variables.search);
      return json({ data: { Page: { pageInfo: { hasNextPage: false }, characters: [
        { id: 1, name: { native: "佐倉瀨津美", alternative: ["佐仓濑津美"] }, image: { large: anilistImage } },
      ] } } });
    }
    requests.vndb.push(body.filters[2]);
    return json({ more: false, results: [{ id: "c1", name: "Setsumi", original: "佐倉瀨津美", image: { url: vndbImage } }] });
  } });
  for (const source of ["bangumi", "anilist", "vndb"]) assert.deepEqual(requests[source], ["佐仓濑津美", "佐倉瀨津美"]);
  assert.deepEqual(result.items.map((item) => `${item.source}:${item.id}`), ["bangumi:1", "anilist:1", "vndb:c1"]);
});

test("browser retry also searches both spellings and keeps usable partial results", async () => {
  const queries: string[] = [];
  const result: CharacterSearchResponse = {
    items: [{ id: "1", source: "anilist", name: "佐仓濑津美", originalName: "Setsumi", imageUrl: anilistImage,
      thumbnailUrl: anilistImage, sourceUrl: "https://anilist.co/character/1", works: [] }],
    hasMore: false,
    errors: [{ source: "anilist", message: "server unavailable" }],
  };
  const recovered = await retryAniListSearchInBrowser("佐仓濑津美", 2, result, new AbortController().signal, async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.variables.page, 2);
    queries.push(body.variables.search);
    if (body.variables.search === "佐仓濑津美") return new Response(null, { status: 503 });
    return json({ data: { Page: { pageInfo: { hasNextPage: true }, characters: [
      { id: 2, name: { native: "佐倉瀨津美" }, image: { large: anilistImage } },
    ] } } });
  });
  assert.deepEqual(queries, ["佐仓濑津美", "佐倉瀨津美", "佐仓濑津美"]);
  assert.deepEqual(recovered.items.map((item) => item.id), ["1", "2"]);
  assert.equal(recovered.hasMore, true);
  assert.equal(recovered.errors.length, 1);
  assert.match(recovered.errors[0].message, /部分结果/);
});

test("non-Latin AniList searches discard unrelated popular fallbacks but retain native names and aliases", async () => {
  const result = await searchCharacters("丛雨", "anilist", 1, { fetcher: async () => json({ data: { Page: {
    pageInfo: { hasNextPage: false }, characters: [
      { id: 1, name: { full: "Satoru Gojou", native: "五条悟" }, image: { large: anilistImage } },
      { id: 2, name: { full: "Murasame", native: "ムラサメ", alternative: ["丛雨"] }, image: { large: anilistImage } },
      { id: 3, name: { full: "Murasame", native: "丛雨" }, image: { large: anilistImage } },
    ],
  } } }) });
  assert.deepEqual(result.items.map((item) => item.id), ["3", "2"]);
  assert.deepEqual(result.errors, []);

  const fallback = await searchCharacters("不支持的关键词", "anilist", 1, { fetcher: async () => json({ data: { Page: {
    pageInfo: { hasNextPage: true }, characters: [
      { id: 1, name: { full: "Satoru Gojou", native: "五条悟" }, image: { large: anilistImage } },
    ],
  } } }) });
  assert.deepEqual(fallback, { items: [], hasMore: false, errors: [], queryVariants: ["不支持的关键词", "不支持的關鍵詞"] });
});

test("other providers keep script variants parallel", { timeout: 5000 }, async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let bothStarted!: () => void;
  const started = new Promise<void>((resolve) => { bothStarted = resolve; });
  const queries: string[] = [];
  const pending = searchCharacters("佐仓濑津美", "vndb", 1, { fetcher: async (_url, init) => {
    queries.push(JSON.parse(String(init?.body)).filters[2]);
    if (queries.length === 2) bothStarted();
    await gate;
    return json({ more: false, results: [] });
  } });
  await started;
  assert.deepEqual(queries, ["佐仓濑津美", "佐倉瀨津美"]);
  release();
  await pending;
});

test("Bangumi script variants are sequential rather than a simultaneous burst", { timeout: 5000 }, async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const queries: string[] = [];
  const pending = searchCharacters("佐仓濑津美", "bangumi", 1, { fetcher: async (_url, init) => {
    queries.push(JSON.parse(String(init?.body)).keyword);
    markStarted();
    await gate;
    return json({ total: 0, data: [] });
  } });
  await started;
  assert.deepEqual(queries, ["佐仓濑津美"]);
  release();
  await pending;
  assert.deepEqual(queries, ["佐仓濑津美", "佐倉瀨津美"]);
});

test("Bangumi stops subsequent spellings after rate limits, access denials or Retry-After", async () => {
  for (const status of [429, 403, 503]) {
    let calls = 0;
    const result = await searchCharacters("佐仓濑津美", "bangumi", 1, { fetcher: async () => {
      calls++;
      return new Response(null, { status, headers: status === 503 ? { "Retry-After": "60" } : {} });
    } });
    assert.equal(calls, 1);
    assert.equal(result.errors.length, 1);
  }
});

test("Bangumi shares one retry budget across the complete spelling set", async () => {
  const queries: string[] = [];
  const result = await searchCharacters("佐仓濑津美", "bangumi", 1, { fetcher: async (_url, init) => {
    queries.push(JSON.parse(String(init?.body)).keyword);
    return new Response(null, { status: 503 });
  } });
  assert.deepEqual(queries, ["佐仓濑津美", "佐仓濑津美", "佐倉瀨津美"]);
  assert.equal(result.errors.length, 1);
});

test("completed Bangumi script combinations share a short cache across scripts and isolate credentials", async () => {
  let now = 1000;
  const cache = createBangumiSearchCache(() => now);
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return json({ total: 0, data: [] }); };
  await searchCharacters("佐仓濑津美", "bangumi", 1, { fetcher, bangumiCache: cache, bangumiAccessToken: "scope-a" });
  const reversed = await searchCharacters("佐倉瀨津美", "bangumi", 1, { fetcher, bangumiCache: cache, bangumiAccessToken: "scope-a" });
  assert.equal(calls, 2);
  assert.deepEqual(reversed.queryVariants, ["佐倉瀨津美", "佐仓濑津美"]);
  await searchCharacters("佐仓濑津美", "bangumi", 1, { fetcher, bangumiCache: cache, bangumiAccessToken: "scope-b" });
  assert.equal(calls, 4);
  now += 60001;
  await searchCharacters("佐仓濑津美", "bangumi", 1, { fetcher, bangumiCache: cache, bangumiAccessToken: "scope-a" });
  assert.equal(calls, 6);
  assert.equal(JSON.stringify(reversed).includes("scope-a"), false);
});

test("browser fallback reuses server spellings without recomputing or changing them", async () => {
  const queries: string[] = [];
  const spellings = ["服务端拼写", "服務端拼寫"];
  const result: CharacterSearchResponse = {
    items: [], hasMore: false, errors: [{ source: "anilist", message: "unavailable" }], queryVariants: spellings,
  };
  const recovered = await retryAniListSearchInBrowser("Alias", 1, result, new AbortController().signal, async (_url, init) => {
    const query = JSON.parse(String(init?.body)).variables.search;
    queries.push(query);
    return json({ data: { Page: { pageInfo: { hasNextPage: false }, characters: [
      { id: query === spellings[0] ? 1 : 2, name: { native: query }, image: { large: anilistImage } },
    ] } } });
  });
  assert.deepEqual(queries, spellings);
  assert.deepEqual(recovered.queryVariants, spellings);
  assert.equal(recovered.items.length, 2);
});

test("cancelling a proxied search aborts upstream requests", { timeout: 5000 }, async () => {
  const controller = new AbortController();
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  let upstreamSignal: AbortSignal | null = null;
  const pending = searchCharacters("Murasame", "vndb", 1, { signal: controller.signal, fetcher: async (_url, init) => {
    upstreamSignal = init!.signal!;
    markStarted();
    return new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
  } });
  await started;
  controller.abort();
  const result = await pending;
  assert.equal((upstreamSignal as AbortSignal | null)?.aborted, true);
  assert.equal(result.items.length, 0);
  assert.equal(result.errors.length, 1);
});

test("query validation bounds text, source and pagination before any upstream request", () => {
  assert.deepEqual(characterSearchSchema.parse({ query: "  丛雨  " }), { query: "丛雨", source: "all", page: 1 });
  for (const input of [
    { query: " " }, { query: "a".repeat(101) }, { query: "test", source: "https://private" },
    { query: "test", page: "NaN" }, { query: "test", page: 0 }, { query: "test", page: 21 }, { query: "test", page: 1.5 },
  ]) assert.equal(characterSearchSchema.safeParse(input).success, false);
});

test("image proxy allowlist blocks URL credential tricks, alternate hosts, ports and unrelated paths", () => {
  assert.equal(isCharacterImageUrl("bangumi", bangumiImage), true);
  assert.equal(isCharacterImageUrl("bangumi", `${bangumiImage}?r=1728761723`), true);
  assert.equal(isCharacterImageUrl("bangumi", bangumiImage.replace("/pic/", "/r/100/pic/")), true);
  assert.equal(isCharacterImageUrl("anilist", anilistImage), true);
  assert.equal(isCharacterImageUrl("vndb", vndbImage), true);
  assert.equal(isCharacterImageUrl("vndb", vndbImage.replace("t.vndb", "s.vndb")), true);
  for (const url of [
    "http://127.0.0.1/secret.jpg", "https://169.254.169.254/latest/meta-data.jpg",
    "https://lain.bgm.tv.evil.test/pic/crt/l/a.jpg", "https://lain.bgm.tv@evil.test/pic/crt/l/a.jpg",
    "https://evil.test@lain.bgm.tv/pic/crt/l/a.jpg", "https://lain.bgm.tv:8443/pic/crt/l/a.jpg",
    "https://lain.bgm.tv/pic/crt/l/a.jpg?redirect=http://localhost", "https://lain.bgm.tv/pic/crt/l/a.jpg#fragment",
    `${bangumiImage}?r=1&r=2`, `${bangumiImage}?r=1&redirect=http://localhost`, `${bangumiImage}?r=http://localhost`,
    `${bangumiImage}?r=1%26redirect%3Dhttp%3A%2F%2Flocalhost`,
    "https://lain.bgm.tv/pic/crt/l/../../../secret.jpg", "https://lain.bgm.tv/pic/crt/l/a.svg",
    "https://lain.bgm.tv/pic/crt/l/a.gif", "https://lain.bgm.tv/private.jpg", vndbImage,
  ]) assert.equal(isCharacterImageUrl("bangumi", url), false, url);
  assert.equal(isCharacterImageUrl("anilist", "https://s4.anilist.co/file/anilistcdn/user/avatar/large/a.png"), false);
  assert.equal(isCharacterImageUrl("anilist", `${anilistImage}?r=1728761723`), false);
  assert.equal(isCharacterImageUrl("vndb", `${vndbImage}?r=1728761723`), false);
});

test("Bangumi cache revision portraits remain searchable and keep their revision when scripts are merged", async () => {
  const result = await searchCharacters("佐仓濑津美", "bangumi", 1, { fetcher: async () => json({ total: 1, data: [{
    id: 12258, name: "佐倉瀬津美", infobox: [{ key: "简体中文名", value: "佐仓濑津美" }],
    images: { large: `${bangumiImage}?r=1728761723`, small: `${bangumiImage}?r=1728761723` },
  }] }) });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].name, "佐仓濑津美");
  assert.equal(result.items[0].imageUrl, `${bangumiImage}?r=1728761723`);
  assert.equal(result.items[0].thumbnailUrl, `${bangumiImage}?r=1728761723`);
});

test("image download rejects non-images, forged MIME types, oversized bodies and HTTP errors", async () => {
  const responses = [
    new Response("<svg />", { headers: { "Content-Type": "image/svg+xml" } }),
    new Response("<html>error</html>", { headers: { "Content-Type": "image/jpeg" } }),
    new Response("x", { headers: { "Content-Type": "image/png", "Content-Length": String(MAX_CHARACTER_IMAGE_BYTES + 1) } }),
    new Response(new Uint8Array(MAX_CHARACTER_IMAGE_BYTES + 1), { headers: { "Content-Type": "image/jpeg" } }),
    new Response(null, { status: 404 }),
  ];
  for (const response of responses) {
    await assert.rejects(fetchCharacterImage("bangumi", bangumiImage, async () => response));
  }
  let requested = false;
  await assert.rejects(fetchCharacterImage("bangumi", "http://127.0.0.1/secret.jpg", async () => {
    requested = true;
    return responses[0];
  }));
  assert.equal(requested, false);
});

test("validated image bytes retain their MIME type and redirects are disabled", async () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const image = await fetchCharacterImage("bangumi", bangumiImage, async (_url, init) => {
    assert.equal(init?.redirect, "manual");
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.referrerPolicy, "no-referrer");
    assert.ok(init?.signal);
    return new Response(bytes, { headers: { "Content-Type": "image/jpeg; charset=binary" } });
  });
  assert.deepEqual(image.bytes, bytes);
  assert.equal(image.contentType, "image/jpeg");
});

test("image redirects are rejected without requesting the redirected destination", async () => {
  let requests = 0;
  await assert.rejects(fetchCharacterImage("vndb", vndbImage, async (_url, init) => {
    requests++;
    assert.equal(init?.redirect, "manual");
    return new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/private.jpg" } });
  }));
  assert.equal(requests, 1);
});

test("browser retry recovers only AniList, preserves other providers and errors, and never sends site credentials", async () => {
  const result: CharacterSearchResponse = {
    items: [{ id: "c1", source: "vndb", name: "Murasame", originalName: "Murasame", imageUrl: vndbImage,
      thumbnailUrl: vndbImage, sourceUrl: "https://vndb.org/c1", works: [] }],
    hasMore: false,
    errors: [{ source: "anilist", message: "upstream blocked" }, { source: "bangumi", message: "unavailable" }],
  };
  const recovered = await retryAniListSearchInBrowser("Murasame", 2, result, new AbortController().signal, async (url, init) => {
    assert.equal(String(url), "https://graphql.anilist.co");
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.referrerPolicy, "no-referrer");
    assert.equal(new Headers(init?.headers).has("Authorization"), false);
    assert.equal(new Headers(init?.headers).has("Cookie"), false);
    assert.deepEqual(JSON.parse(String(init?.body)).variables, { search: "Murasame", page: 2, perPage: 12 });
    return json({ data: { Page: { pageInfo: { hasNextPage: true }, characters: [
      { id: 1, name: { full: "Murasame", native: "ムラサメ" }, image: { large: anilistImage } },
    ] } } });
  });
  assert.deepEqual(recovered.items.map((item) => item.source), ["anilist", "vndb"]);
  assert.deepEqual(recovered.errors, [{ source: "bangumi", message: "unavailable" }]);
  assert.equal(recovered.hasMore, true);
  assert.equal(result.items.length, 1);
  assert.equal(result.errors.length, 2);
});

test("browser retry is skipped for successful sources and preserves results when direct access also fails", async () => {
  const result: CharacterSearchResponse = { items: [], errors: [], hasMore: false };
  const unexpectedFetch: typeof fetch = async () => { throw new Error("unexpected fetch"); };
  assert.equal(await retryAniListSearchInBrowser("test", 1, result, new AbortController().signal, unexpectedFetch), result);
  const failed: CharacterSearchResponse = { ...result, errors: [{ source: "anilist", message: "unavailable" }] };
  assert.equal(await retryAniListSearchInBrowser("test", 1, failed, new AbortController().signal, async () => new Response(null, { status: 503 })), failed);
  const aborted = new AbortController();
  aborted.abort();
  assert.equal(await retryAniListSearchInBrowser("test", 1, failed, aborted.signal, unexpectedFetch), failed);
});

test("cancelling a browser search cancels the direct AniList request and cannot replace newer results", async () => {
  const result: CharacterSearchResponse = { items: [], errors: [{ source: "anilist", message: "unavailable" }], hasMore: false };
  const controller = new AbortController();
  const recovered = await retryAniListSearchInBrowser("test", 1, result, controller.signal, async (_url, init) => {
    assert.equal(init?.signal?.aborted, false);
    controller.abort();
    assert.equal(init?.signal?.aborted, true);
    throw new DOMException("Aborted", "AbortError");
  });
  assert.equal(recovered, result);
});
