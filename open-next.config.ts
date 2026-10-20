// open-next.config.ts
import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
import doShardedTagCache from "@opennextjs/cloudflare/overrides/tag-cache/do-sharded-tag-cache";
import doQueue from "@opennextjs/cloudflare/overrides/queue/do-queue";

export default defineCloudflareConfig({
  incrementalCache: r2IncrementalCache,
  // Disable regional tag caching so an admin edit invalidates public settings
  // immediately for every visitor, including those in other Cloudflare regions.
  tagCache: doShardedTagCache({ baseShardSize: 1, regionalCache: false }),
  queue: doQueue,
});
