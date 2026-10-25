import handler from "./.open-next/worker.js";
import { cacheVoteImageResponse } from "./lib/image/image-cache.ts";
import resvgWasm from "./lib/bracket-image/resvg.wasm";
import { CHARACTER_THUMBNAIL_PATH, handleCharacterThumbnail } from "./lib/character-search/thumbnail-proxy.ts";

export { DOQueueHandler, DOShardedTagCache } from "./.open-next/worker.js";

const worker = {
  async fetch(request, env, ctx) {
    if (new URL(request.url).pathname.replace(/\/$/, "") === CHARACTER_THUMBNAIL_PATH) {
      return handleCharacterThumbnail(request, { cache: caches.default, waitUntil: (promise) => ctx.waitUntil(promise) });
    }
    // Wrangler imports a compiled module from this stable entry point. Next.js
    // may move shared helpers between route files/chunks during optimization.
    const response = await handler.fetch(request, { ...env, RESVG_WASM: resvgWasm }, ctx);
    return cacheVoteImageResponse(request.url, response, env.NEXT_PUBLIC_SUPABASE_URL);
  },
};

export default worker;
