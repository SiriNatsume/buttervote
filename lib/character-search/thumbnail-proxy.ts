import { fetchCharacterImage, isCharacterImageUrl } from "./image";
import { CHARACTER_SOURCES, type CharacterSource } from "./types";
import { CHARACTER_THUMBNAIL_PATH } from "./thumbnail-url";

type EdgeCache = { match(request: Request): Promise<Response | undefined>; put(request: Request, response: Response): Promise<unknown> };
type Runtime = { cache?: EdgeCache; waitUntil?: (promise: Promise<unknown>) => void };
type ImageEntry = { bytes: Uint8Array<ArrayBuffer>; contentType: string; etag: string; expiresAt: number };

const TTL_MS = 86400000;
const MAX_MEMORY_BYTES = 4 * 1024 * 1024;
const MAX_MEMORY_ENTRIES = 64;
const MAX_THUMBNAIL_BYTES = 512 * 1024;
const PUBLIC_HEADERS = {
  "Cache-Control": "public, max-age=3600, s-maxage=86400",
  "Cross-Origin-Resource-Policy": "same-site",
  "X-Content-Type-Options": "nosniff",
};

export function createCharacterThumbnailProxy({ fetcher = fetch, now = Date.now, concurrency = 8 }: {
  fetcher?: typeof fetch; now?: () => number; concurrency?: number;
} = {}) {
  const memory = new Map<string, ImageEntry>();
  const pending = new Map<string, Promise<ImageEntry>>();
  let memoryBytes = 0;
  let active = 0;
  const queue: (() => void)[] = [];

  function forget(key: string) {
    const entry = memory.get(key);
    if (entry) memoryBytes -= entry.bytes.byteLength;
    memory.delete(key);
  }

  async function acquire() {
    if (active < concurrency) { active++; return; }
    if (queue.length >= 32) throw new Error("Thumbnail queue full");
    await new Promise<void>((resolve, reject) => {
      const ready = () => { clearTimeout(timer); active++; resolve(); };
      const timer = setTimeout(() => {
        const index = queue.indexOf(ready);
        if (index >= 0) queue.splice(index, 1);
        reject(new Error("Thumbnail queue timeout"));
      }, 4000);
      queue.push(ready);
    });
  }

  function imageResponse(entry: ImageEntry, cacheStatus: string) {
    return new Response(entry.bytes, { headers: {
      ...PUBLIC_HEADERS, "Content-Type": entry.contentType,
      "Content-Length": String(entry.bytes.byteLength), ETag: entry.etag,
      "X-Character-Image-Cache": cacheStatus,
    } });
  }

  async function finish(response: Response, request: Request) {
    if (request.headers.get("If-None-Match") === response.headers.get("ETag") && response.headers.has("ETag")) {
      await response.body?.cancel();
      const headers = new Headers(response.headers);
      headers.delete("Content-Length");
      return new Response(null, { status: 304, headers });
    }
    if (request.method === "HEAD") {
      await response.body?.cancel();
      return new Response(null, { headers: response.headers });
    }
    return response;
  }

  return async function thumbnail(request: Request, runtime: Runtime = {}): Promise<Response> {
    const error = (status: number, message: string) => Response.json({ error: message }, {
      status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...(status === 405 ? { Allow: "GET, HEAD" } : {}) },
    });
    if (!["GET", "HEAD"].includes(request.method)) return error(405, "仅支持读取预览图片。");
    const params = new URL(request.url).searchParams;
    const source = params.get("source") as CharacterSource;
    const url = params.get("url") ?? "";
    if (!CHARACTER_SOURCES.includes(source) || url.length > 1500 || !isCharacterImageUrl(source, url)) return error(400, "角色图片地址无效。");

    const keyUrl = new URL("/_character-thumbnail-cache/v1", request.url);
    keyUrl.search = new URLSearchParams({ source, url }).toString();
    const key = keyUrl.href;
    const cached = memory.get(key);
    if (cached && cached.expiresAt > now()) {
      memory.delete(key); memory.set(key, cached);
      return finish(imageResponse(cached, "MEMORY"), request);
    }
    if (cached) forget(key);
    const cacheKey = new Request(key);
    try {
      const edge = await runtime.cache?.match(cacheKey);
      if (edge?.status === 200 && !edge.headers.has("Set-Cookie") && /^image\/(jpeg|png|webp)$/.test(edge.headers.get("Content-Type") ?? "")) {
        const headers = new Headers(edge.headers);
        headers.set("X-Character-Image-Cache", "HIT");
        return finish(new Response(edge.body, { headers }), request);
      }
      await edge?.body?.cancel();
    } catch { /* Cache outages must not prevent loading a public portrait. */ }

    // Another request can finish while this request is reading the edge cache.
    const filled = memory.get(key);
    if (filled && filled.expiresAt > now()) return finish(imageResponse(filled, "MEMORY"), request);

    let flight = pending.get(key);
    const coalesced = Boolean(flight);
    if (!flight) {
      flight = (async () => {
        await acquire();
        try {
          const image = await fetchCharacterImage(source, url, (input, init) => {
            const headers = new Headers(init?.headers);
            headers.set("User-Agent", "SiriNatsume/buttervote (https://github.com/SiriNatsume/buttervote)");
            return fetcher(input, { ...init, headers });
          }, { maxBytes: MAX_THUMBNAIL_BYTES, timeoutMs: 8000 });
          const digest = await crypto.subtle.digest("SHA-256", image.bytes);
          const etag = `"${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}"`;
          const entry: ImageEntry = { ...image, etag, expiresAt: now() + TTL_MS };
          for (const [entryKey, value] of memory) if (value.expiresAt <= now()) forget(entryKey);
          forget(key); memory.set(key, entry); memoryBytes += image.bytes.byteLength;
          while (memory.size > MAX_MEMORY_ENTRIES || memoryBytes > MAX_MEMORY_BYTES) forget(memory.keys().next().value!);
          if (runtime.cache) {
            const put = runtime.cache.put(cacheKey, imageResponse(entry, "HIT")).catch(() => undefined);
            if (runtime.waitUntil) runtime.waitUntil(put); else await put;
          }
          return entry;
        } finally { active--; queue.shift()?.(); }
      })().finally(() => pending.delete(key));
      pending.set(key, flight);
      runtime.waitUntil?.(flight.then(() => undefined, () => undefined));
    }
    try { return finish(imageResponse(await flight, coalesced ? "COALESCED" : "MISS"), request); }
    catch { return error(502, "预览图片暂时无法加载，请稍后重试。"); }
  };
}

export const handleCharacterThumbnail = createCharacterThumbnailProxy();
export { CHARACTER_THUMBNAIL_PATH };
