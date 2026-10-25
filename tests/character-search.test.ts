import assert from "node:assert/strict";
import test from "node:test";
import { characterSearchSchema, searchCharacters } from "../lib/character-search/providers";
import { fetchCharacterImage, isCharacterImageUrl, MAX_CHARACTER_IMAGE_BYTES } from "../lib/character-search/image";

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

test("single-source search requests only that provider and distinguishes no results from failures", async () => {
  let requests = 0;
  const result = await searchCharacters("不存在的角色", "vndb", 1, { fetcher: async (input) => {
    requests++;
    assert.equal(String(input), "https://api.vndb.org/kana/character");
    return json({ results: [], more: false });
  } });
  assert.equal(requests, 1);
  assert.deepEqual(result, { items: [], hasMore: false, errors: [] });
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
  assert.deepEqual(fallback, { items: [], hasMore: false, errors: [] });
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
  assert.equal(isCharacterImageUrl("bangumi", bangumiImage.replace("/pic/", "/r/100/pic/")), true);
  assert.equal(isCharacterImageUrl("anilist", anilistImage), true);
  assert.equal(isCharacterImageUrl("vndb", vndbImage), true);
  assert.equal(isCharacterImageUrl("vndb", vndbImage.replace("t.vndb", "s.vndb")), true);
  for (const url of [
    "http://127.0.0.1/secret.jpg", "https://169.254.169.254/latest/meta-data.jpg",
    "https://lain.bgm.tv.evil.test/pic/crt/l/a.jpg", "https://lain.bgm.tv@evil.test/pic/crt/l/a.jpg",
    "https://evil.test@lain.bgm.tv/pic/crt/l/a.jpg", "https://lain.bgm.tv:8443/pic/crt/l/a.jpg",
    "https://lain.bgm.tv/pic/crt/l/a.jpg?redirect=http://localhost", "https://lain.bgm.tv/pic/crt/l/a.jpg#fragment",
    "https://lain.bgm.tv/pic/crt/l/../../../secret.jpg", "https://lain.bgm.tv/pic/crt/l/a.svg",
    "https://lain.bgm.tv/pic/crt/l/a.gif", "https://lain.bgm.tv/private.jpg", vndbImage,
  ]) assert.equal(isCharacterImageUrl("bangumi", url), false, url);
  assert.equal(isCharacterImageUrl("anilist", "https://s4.anilist.co/file/anilistcdn/user/avatar/large/a.png"), false);
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
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    return new Response(bytes, { headers: { "Content-Type": "image/jpeg; charset=binary" } });
  });
  assert.deepEqual(image.bytes, bytes);
  assert.equal(image.contentType, "image/jpeg");
});
