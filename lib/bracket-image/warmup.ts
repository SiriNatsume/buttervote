import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createPublicClient } from "@/lib/supabase/public";
import { createServiceClient } from "@/lib/supabase/service";
import { serverArtifacts } from "@/lib/cache/server-artifacts";
import { exportBracketImage, loadBracketExportState } from "./export";

const pending = new Map<string, Promise<void>>();

export async function warmBracketImage(groupId: string, tournamentId?: string | null) {
  const state = await loadBracketExportState(groupId, tournamentId);
  if (!state?.cacheable) return;
  // An administrator may trigger warmup, but its bytes are always built using
  // anonymous group access and canonical public visibility, never admin results.
  await exportBracketImage({ caller: createPublicClient(), groupId, tournamentId: state.tournamentId });
}

function background(key: string, work: () => Promise<void>) {
  let context;
  try { context = getCloudflareContext(); } catch { return; }
  if (pending.has(key) || pending.size >= 2) return;
  const job = work().catch((error: unknown) => {
    console.warn("Bracket image warmup deferred", error instanceof Error ? error.message : "warmup unavailable");
  }).finally(() => pending.delete(key));
  pending.set(key, job);
  context.ctx.waitUntil(job);
}

export function scheduleBracketImageWarmup(groupId: string) {
  background(groupId, () => warmBracketImage(groupId));
}

// The existing minute cron also picks up direct database edits and gives older
// featured tournaments a warm image after deployment. Work is bounded and serial.
export function scheduleFeaturedBracketWarmup() {
  background("featured", async () => {
    const service = createServiceClient();
    if (!service) return;
    const saved = await serverArtifacts.read("bracket-warmup-cursor-v1", "featured", "1");
    const cursor = saved?.byteLength === 36 ? new TextDecoder().decode(saved) : "";
    let query = service.from("contest_group_homepage_settings")
      .select("contest_group_id,featured_tournament_id").eq("show_bracket", true)
      .not("featured_tournament_id", "is", null).order("contest_group_id").limit(3);
    if (/^[a-f0-9-]{36}$/.test(cursor)) query = query.gt("contest_group_id", cursor);
    const { data, error } = await query;
    if (error) throw new Error("Featured bracket lookup unavailable");
    for (const row of data ?? []) {
      try { await warmBracketImage(row.contest_group_id, row.featured_tournament_id); }
      catch { console.warn("Featured bracket warmup will retry on the next sweep"); }
      await serverArtifacts.write("bracket-warmup-cursor-v1", "featured", "1", new TextEncoder().encode(row.contest_group_id), 86_400_000);
    }
    if ((data?.length ?? 0) < 3) {
      await serverArtifacts.write("bracket-warmup-cursor-v1", "featured", "1", new Uint8Array(), 86_400_000);
    }
  });
}
