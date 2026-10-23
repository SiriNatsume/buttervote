import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { serverArtifacts } from "@/lib/cache/server-artifacts";
import type { Database } from "@/lib/types";
import { bracketImageDataFromSnapshot, type BracketImageSnapshot } from "./data";
import { createBracketImageExporter, type BracketExportState } from "./export-core";
import { renderBracketImageWithAssets } from "./svg";
import { cachedSvgToPng } from "./png";

const stateSchema = z.object({
  groupId: z.string().uuid(), groupName: z.string(), tournamentId: z.string().uuid(),
  revision: z.string().regex(/^[a-f0-9]{64}$/), cacheable: z.boolean(),
  visibilityVersion: z.string().regex(/^\d+$/),
  assets: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/).nullable()),
  snapshot: z.unknown().optional(),
});

export async function loadBracketExportState(groupId: string, tournamentId?: string | null, snapshot = false, expected?: string) {
  const service = createServiceClient();
  if (!service) throw new Error("Bracket export service is unavailable");
  const { data, error } = await service.rpc("get_bracket_image_export_state", {
    p_group_id: groupId, p_tournament_id: tournamentId ?? null,
    p_include_snapshot: snapshot, p_expected_revision: expected ?? null,
  });
  if (error) throw new Error(`Bracket export state unavailable: ${error.message}`);
  if (!data) return null;
  const parsed = stateSchema.parse(data);
  if (parsed.groupId !== groupId) throw new Error("Bracket export group mismatch");
  return parsed;
}

async function build(state: BracketExportState) {
  const current = await loadBracketExportState(state.groupId, state.tournamentId, true, state.revision);
  if (!current?.snapshot || current.revision !== state.revision) return null;
  const data = bracketImageDataFromSnapshot(current.snapshot as BracketImageSnapshot, state.groupId, current.groupName);
  if (!data.matches.length || data.visibilityVersion !== state.visibilityVersion) return null;
  const rendered = await renderBracketImageWithAssets(data, current.assets);
  const png = await cachedSvgToPng(`bracket-${data.groupId}`, rendered.svg);
  return {
    png, visibilityVersion: data.visibilityVersion,
    complete: rendered.complete && data.matches.every((match) => !match.resultVisible
      || [match.left, match.right].every((p) => !p || p.score !== null)),
  };
}

export const exportBracketImage = createBracketImageExporter<SupabaseClient<Database>>({
  cache: serverArtifacts, loadState: loadBracketExportState, build,
  async authorize(client, groupId) {
    const { data, error } = await client.from("contest_groups").select("id").eq("id", groupId).maybeSingle();
    if (error) throw new Error("Bracket group authorization unavailable");
    return Boolean(data);
  },
});
