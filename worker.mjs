import handler from "./.open-next/worker.js";
import { cacheVoteImageResponse } from "./lib/image/image-cache.ts";

export { DOQueueHandler, DOShardedTagCache } from "./.open-next/worker.js";

const worker = {
  async fetch(request, env, ctx) {
    const response = await handler.fetch(request, env, ctx);
    return cacheVoteImageResponse(request.url, response, env.NEXT_PUBLIC_SUPABASE_URL);
  },
};

export default worker;
