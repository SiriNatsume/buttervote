import handler from "./.open-next/worker.js";
import { cacheVoteImageResponse } from "./lib/image/image-cache.ts";
import resvgWasm from "./lib/bracket-image/resvg.wasm";

export { DOQueueHandler, DOShardedTagCache } from "./.open-next/worker.js";

const worker = {
  async fetch(request, env, ctx) {
    // Wrangler imports a compiled module from this stable entry point. Next.js
    // may move shared helpers between route files/chunks during optimization.
    const response = await handler.fetch(request, { ...env, RESVG_WASM: resvgWasm }, ctx);
    return cacheVoteImageResponse(request.url, response, env.NEXT_PUBLIC_SUPABASE_URL);
  },
};

export default worker;
