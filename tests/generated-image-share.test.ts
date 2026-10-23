import assert from "node:assert/strict";
import test from "node:test";
import { createRevalidatedPng } from "../lib/revalidated-png.ts";
import { copyPngBlobToClipboard, sharePng } from "../lib/generated-image-share.ts";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const png = (value = "original pixels", etag: string | null = 'W/"v1"') => new Response(value, {
  headers: { "Content-Type": "image/png", ...(etag ? { ETag: etag } : {}) },
});

test("prefetched PNG bytes wait for fresh validation on every click, with HTTP storage disabled", async () => {
  const requests: RequestInit[] = [];
  let validate!: (response: Response) => void;
  const image = createRevalidatedPng("/image", "failed", async (_url, init) => {
    requests.push(init!);
    if (requests.length === 1) return png();
    return new Promise<Response>((resolve) => { validate = resolve; });
  });
  image.prefetch();
  await flush();
  let released = false;
  const clicked = image.get().then((blob) => { released = true; return blob; });
  await flush();
  assert.equal(released, false, "prepared bytes cannot reach the clipboard before authorization");
  assert.equal(new Headers(requests[1].headers).get("if-none-match"), 'W/"v1"');
  assert.ok(requests.every((request) => request.cache === "no-store" && request.credentials === "same-origin"));
  validate(new Response(null, { status: 304, headers: { ETag: 'W/"v1"' } }));
  const first = await clicked;
  const repeated = image.get();
  validate(new Response(null, { status: 304, headers: { ETag: 'W/"v1"' } }));
  assert.equal(await repeated, first, "reuse the original Blob without re-encoding");
  assert.equal(await first.text(), "original pixels");
  assert.equal(requests.length, 3);
});

test("score changes replace prepared bytes, and denied or failed validation clears them", async () => {
  for (const failure of [404, 409, 500]) {
    const requests: RequestInit[] = [];
    const image = createRevalidatedPng("/image", "failed", async (_url, init) => {
      requests.push(init!);
      if (requests.length === 1) return png();
      if (requests.length === 2) return png("new score", 'W/"v2"');
      if (requests.length === 3) return Response.json({ error: "状态已更新" }, { status: failure });
      return png("latest score", 'W/"v3"');
    });
    image.prefetch(); await flush();
    assert.equal(await (await image.get()).text(), "new score");
    await assert.rejects(image.get(), /状态已更新/);
    assert.equal(await (await image.get()).text(), "latest score");
    assert.equal(new Headers(requests[2].headers).get("if-none-match"), 'W/"v2"');
    assert.equal(new Headers(requests[3].headers).has("if-none-match"), false);
  }
});

test("a click interrupts unfinished speculation; late and unmounted results cannot restore old bytes", async () => {
  let finishPrefetch!: (response: Response) => void;
  let finishClick!: (response: Response) => void;
  const requests: RequestInit[] = [];
  const image = createRevalidatedPng("/image", "failed", async (_url, init) => {
    requests.push(init!);
    if (requests.length === 1) return new Promise<Response>((resolve) => { finishPrefetch = resolve; });
    if (requests.length === 2) return png("fresh", 'W/"v2"');
    if (requests.length === 3) return new Promise<Response>((resolve) => { finishClick = resolve; });
    return png("after remount");
  });
  image.prefetch();
  const clicked = image.get();
  assert.equal(requests[0].signal?.aborted, true);
  assert.equal(await (await clicked).text(), "fresh");
  finishPrefetch(png("old")); await flush();
  const second = image.get();
  assert.equal(new Headers(requests[2].headers).get("if-none-match"), 'W/"v2"');
  image.clear();
  finishClick(new Response(null, { status: 304, headers: { ETag: 'W/"v2"' } }));
  await assert.rejects(second, { name: "AbortError" });
  assert.equal(await (await image.get()).text(), "after remount");
  assert.equal(new Headers(requests[3].headers).has("if-none-match"), false);
});

test("live, incomplete and oversized PNGs never receive client reuse, and unsolicited 304 fails closed", async () => {
  for (const response of [() => png("live", null), () => png("x".repeat(4 * 1024 * 1024 + 1))]) {
    const requests: RequestInit[] = [];
    const image = createRevalidatedPng("/image", "failed", async (_url, init) => { requests.push(init!); return response(); });
    image.prefetch(); await flush();
    await image.get();
    assert.equal(new Headers(requests[1].headers).has("if-none-match"), false);
  }
  let count = 0;
  const deferred = createRevalidatedPng("/image", "failed", async () => ++count === 1 ? new Response(null, { status: 204 }) : png("live", null));
  deferred.prefetch(); await flush();
  assert.equal(await (await deferred.get()).text(), "live");
  const invalid = createRevalidatedPng("/image", "failed", async () => new Response(null, { status: 304 }));
  await assert.rejects(invalid.get(), /failed/);
});

test("clipboard write starts during the click, waits for validated bytes and downloads the same Blob on denial", async () => {
  let deliver!: (blob: Blob) => void;
  const pending = new Promise<Blob>((resolve) => { deliver = resolve; });
  const original = new Blob(["original PNG"], { type: "image/png" });
  let started = false;
  let downloaded = false;
  const sharing = sharePng(pending, "bracket.png", {
    copy: async (blob) => { started = true; assert.equal(await blob, original); throw new Error("NotAllowedError"); },
    download: (blob, name) => { assert.equal(blob, original); assert.equal(name, "bracket.png"); downloaded = true; },
  });
  assert.equal(started, true);
  assert.equal(downloaded, false);
  deliver(original);
  assert.equal(await sharing, "downloaded");
  assert.equal(downloaded, true);
  const failed = Promise.reject(new Error("permission revoked"));
  await assert.rejects(sharePng(failed, "bracket.png", {
    copy: async (blob) => { await blob; return true; },
    download: () => assert.fail("revocation must never download prepared bytes"),
  }), /permission revoked/);
});

test("the browser clipboard receives a deferred PNG without awaiting the network first", async (t) => {
  let data: Record<string, Blob | Promise<Blob>> | undefined;
  let written = false;
  class Item { constructor(value: Record<string, Blob | Promise<Blob>>) { data = value; } }
  for (const [name, value] of Object.entries({
    navigator: { clipboard: { write: async () => { written = true; } } },
    window: { ClipboardItem: Item }, ClipboardItem: Item,
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  let deliver!: (blob: Blob) => void;
  const pending = new Promise<Blob>((resolve) => { deliver = resolve; });
  const copying = copyPngBlobToClipboard(pending);
  assert.equal(written, true);
  assert.equal(data?.["image/png"], pending);
  deliver(new Blob(["png"], { type: "image/png" }));
  assert.equal(await copying, true);
});
