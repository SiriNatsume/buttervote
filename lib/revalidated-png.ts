import { readPngBlob } from "./generated-image-share";

type PreparedPng = { blob: Blob; etag: string };
const MAX_PREPARED_BYTES = 4 * 1024 * 1024;

// One in-memory image per mounted share control. Nothing is persisted in the
// browser HTTP cache, and prepared bytes are NEVER used without a new request.
export function createRevalidatedPng(
  url: string, fallbackErrorMessage: string, fetcher: typeof fetch = fetch,
) {
  let prepared: PreparedPng | null = null;
  let speculative: AbortController | null = null;
  let attempted = false;
  let sharing: Promise<Blob> | null = null;
  const active = new Set<AbortController>();

  async function request(previous: PreparedPng | null, prefetch: boolean, controller: AbortController) {
    active.add(controller);
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetcher(url, {
        cache: "no-store", credentials: "same-origin", signal: controller.signal,
        headers: {
          ...(previous ? { "If-None-Match": previous.etag } : {}),
          ...(prefetch ? { "X-Bracket-Prefetch": "1" } : {}),
        },
      });
      controller.signal.throwIfAborted();
      if (response.status === 304) {
        if (!previous || response.headers.get("etag") !== previous.etag) {
          throw new Error(fallbackErrorMessage);
        }
        return previous.blob;
      }
      if (prefetch && response.status === 204) return null;
      const blob = await readPngBlob(response, fallbackErrorMessage);
      controller.signal.throwIfAborted();
      const etag = response.headers.get("etag");
      prepared = etag && blob.size <= MAX_PREPARED_BYTES ? { blob, etag } : null;
      return blob;
    } catch (error) {
      // Failure, revocation or state changes cannot fall back to an old image.
      if (!controller.signal.aborted) prepared = null;
      throw error;
    } finally {
      clearTimeout(timeout);
      active.delete(controller);
    }
  }

  return {
    prefetch() {
      if (attempted || prepared || sharing) return;
      attempted = true;
      const controller = new AbortController();
      speculative = controller;
      void request(null, true, controller).catch(() => {}).finally(() => {
        if (speculative === controller) speculative = null;
      });
    },
    get() {
      if (sharing) return sharing;
      // A click must not queue behind an unfinished background download. The
      // fresh request can share the server's pending render if it is still cold.
      speculative?.abort();
      speculative = null;
      const controller = new AbortController();
      const promise = request(prepared, false, controller).then((blob) => {
        controller.signal.throwIfAborted();
        if (!blob) throw new Error(fallbackErrorMessage);
        return blob;
      }).finally(() => { if (sharing === promise) sharing = null; });
      sharing = promise;
      return promise;
    },
    clear() {
      for (const controller of active) controller.abort();
      prepared = null;
      speculative = null;
      sharing = null;
      attempted = false;
    },
  };
}
