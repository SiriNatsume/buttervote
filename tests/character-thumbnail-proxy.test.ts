import assert from "node:assert/strict";
import test from "node:test";
import { createCharacterThumbnailProxy } from "../lib/character-search/thumbnail-proxy";
import { characterThumbnailUrl } from "../lib/character-search/thumbnail-url";

const image = "https://lain.bgm.tv/r/100/pic/crt/l/0b/f5/12258_crt_G7R9A.jpg?r=1728761723";
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const request = (url = image, init?: RequestInit) => new Request(`https://buttervote.test${characterThumbnailUrl("bangumi", url)}`, init);
const portrait = () => new Response(jpeg, { headers: { "Content-Type": "image/jpeg", "Set-Cookie": "upstream=must-not-leak" } });

function edgeCache() {
  const entries = new Map<string, { bytes: ArrayBuffer; headers: Headers }>();
  return {
    async match(key: Request) { const item = entries.get(key.url); return item ? new Response(item.bytes.slice(0), { headers: item.headers }) : undefined; },
    async put(key: Request, response: Response) { entries.set(key.url, { bytes: await response.arrayBuffer(), headers: new Headers(response.headers) }); },
  };
}

test("public thumbnails never forward account credentials or return upstream cookies", async () => {
  const handler = createCharacterThumbnailProxy({ fetcher: async (url, init) => {
    assert.equal(String(url), image);
    assert.equal(new Headers(init?.headers).has("Cookie"), false);
    assert.equal(new Headers(init?.headers).has("Authorization"), false);
    assert.match(new Headers(init?.headers).get("User-Agent")!, /SiriNatsume\/buttervote/);
    assert.equal(init?.redirect, "manual");
    return portrait();
  } });
  const response = await handler(request(image, { headers: { Cookie: "app_session=private", Authorization: "private" } }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.has("Set-Cookie"), false);
  assert.equal(response.headers.get("Content-Type"), "image/jpeg");
  assert.match(response.headers.get("Cache-Control")!, /public.*s-maxage=86400/);
  assert.equal(response.headers.get("Cross-Origin-Resource-Policy"), "same-site");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), jpeg);
});

test("concurrent identical thumbnails share an origin fetch and warm memory avoids origin entirely", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const handler = createCharacterThumbnailProxy({ fetcher: async () => { calls++; await gate; return portrait(); } });
  const first = handler(request());
  const second = handler(request());
  release();
  const responses = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.deepEqual(responses.map((response) => response.headers.get("X-Character-Image-Cache")), ["MISS", "COALESCED"]);
  const warm = await handler(request());
  assert.equal(warm.headers.get("X-Character-Image-Cache"), "MEMORY");
  assert.equal(calls, 1);
});

test("another isolate reuses the edge cache, while an updated portrait revision has a different cache key", async () => {
  const cache = edgeCache();
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return portrait(); };
  await createCharacterThumbnailProxy({ fetcher })(request(), { cache });
  const handler = createCharacterThumbnailProxy({ fetcher });
  const warm = await handler(request(), { cache });
  assert.equal(warm.headers.get("X-Character-Image-Cache"), "HIT");
  assert.equal(calls, 1);
  await handler(request(image.replace("1728761723", "1728761724")), { cache });
  assert.equal(calls, 2);
});

test("unsafe URLs and methods cannot reach origin or the shared cache", async () => {
  let calls = 0;
  const handler = createCharacterThumbnailProxy({ fetcher: async () => { calls++; return portrait(); } });
  for (const value of ["http://127.0.0.1/private.jpg", "https://storage.example/private.jpg", `${image}&redirect=http://localhost`, "https://lain.bgm.tv/pic/crt/l/image.svg"]) {
    const response = await handler(request(value));
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
  assert.equal((await handler(request(image, { method: "POST" }))).status, 405);
  assert.equal(calls, 0);
});

test("bad images and redirects are not cached and later requests can recover", async () => {
  for (const failure of [
    () => new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/private" } }),
    () => new Response("<html>blocked</html>", { headers: { "Content-Type": "image/jpeg" } }),
    () => new Response("x", { headers: { "Content-Type": "image/jpeg", "Content-Length": String(512 * 1024 + 1) } }),
  ]) {
    let calls = 0;
    const handler = createCharacterThumbnailProxy({ fetcher: async () => ++calls === 1 ? failure() : portrait() });
    const bad = await handler(request());
    assert.equal(bad.status, 502);
    assert.equal(bad.headers.get("Cache-Control"), "no-store");
    assert.equal((await handler(request())).status, 200);
    assert.equal(calls, 2);
  }
});

test("expired memory entries refresh, conditional requests and HEAD do not transfer the image again", async () => {
  let now = 0;
  let calls = 0;
  const handler = createCharacterThumbnailProxy({ now: () => now, fetcher: async () => { calls++; return portrait(); } });
  const cold = await handler(request());
  const etag = cold.headers.get("ETag")!;
  const unchanged = await handler(request(image, { headers: { "If-None-Match": etag } }));
  assert.equal(unchanged.status, 304);
  assert.equal(await unchanged.text(), "");
  const head = await handler(request(image, { method: "HEAD" }));
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal(calls, 1);
  now = 86400001;
  await handler(request());
  assert.equal(calls, 2);
});

test("memory has an entry bound and upstream concurrency is limited", async () => {
  let calls = 0;
  const handler = createCharacterThumbnailProxy({ fetcher: async () => { calls++; return portrait(); } });
  for (let index = 0; index < 65; index++) await handler(request(image.replace("1728761723", String(index))));
  await handler(request(image.replace("1728761723", "0")));
  assert.equal(calls, 66);

  let active = 0;
  let peak = 0;
  const limited = createCharacterThumbnailProxy({ concurrency: 2, fetcher: async () => {
    active++; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--; return portrait();
  } });
  await Promise.all(Array.from({ length: 6 }, (_, index) => limited(request(image.replace("1728761723", String(index))))));
  assert.equal(peak, 2);
});
