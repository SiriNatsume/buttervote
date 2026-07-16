"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActionAdmin } from "@/lib/auth";
import { createRequiredServiceClient } from "@/lib/supabase/service";

type GroupHomepageActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

const homepageSettingsSchema = z.object({
  groupId: z.string().uuid(),
  showBracket: z.boolean(),
  featuredTournamentId: z.string().uuid().nullable(),
});

const relatedPagesSchema = z.object({
  groupId: z.string().uuid(),
  pageIds: z.array(z.string().uuid()).max(100),
});

function refreshGroupHomepage(groupId: string) {
  revalidatePath(`/groups/${groupId}`);
  revalidatePath(`/groups/${groupId}/vote`);
  revalidatePath(`/groups/${groupId}/nominate`);
  revalidatePath(`/groups/${groupId}/results`);
  revalidatePath(`/admin/groups/${groupId}`);
  revalidatePath(`/admin/groups/${groupId}/edit`);
}
async function tournamentBelongsToGroup(
  tournamentId: string,
  groupId: string,
) {
  const supabase = createRequiredServiceClient();
  const { data: stage } = await supabase
    .from("tournament_stages")
    .select("id")
    .eq("tournament_id", tournamentId)
    .eq("group_id", groupId)
    .limit(1)
    .maybeSingle();
  if (stage) return true;

  const { data: contests } = await supabase
    .from("contests")
    .select("id")
    .eq("group_id", groupId);
  const contestIds = (contests ?? []).map((contest) => contest.id);
  if (contestIds.length === 0) return false;

  const { data: match } = await supabase
    .from("tournament_matches")
    .select("id")
    .eq("tournament_id", tournamentId)
    .in("contest_id", contestIds)
    .limit(1)
    .maybeSingle();
  return Boolean(match);
}

export async function updateGroupHomepageSettingsAction(
  formData: FormData,
): Promise<GroupHomepageActionResult> {
  const admin = await getActionAdmin();
  if (!admin.ok) return { ok: false, error: admin.error };

  const selectedTournament = String(formData.get("featuredTournamentId") ?? "");
  const parsed = homepageSettingsSchema.safeParse({
    groupId: formData.get("groupId"),
    showBracket: formData.get("showBracket") === "on",
    featuredTournamentId:
      selectedTournament && selectedTournament !== "none"
        ? selectedTournament
        : null,
  });
  if (!parsed.success) {
    return { ok: false, error: "活动组首页配置无效。" };
  }

  if (
    parsed.data.featuredTournamentId &&
    !(await tournamentBelongsToGroup(
      parsed.data.featuredTournamentId,
      parsed.data.groupId,
    ))
  ) {
    return { ok: false, error: "所选赛事不属于当前活动组。" };
  }

  const supabase = createRequiredServiceClient();
  const { error } = await supabase
    .from("contest_group_homepage_settings")
    .upsert({
      contest_group_id: parsed.data.groupId,
      show_bracket: parsed.data.showBracket,
      featured_tournament_id: parsed.data.featuredTournamentId,
    });
  if (error) return { ok: false, error: error.message };

  refreshGroupHomepage(parsed.data.groupId);
  return { ok: true, message: "活动组首页设置已保存。" };
}

export async function setGroupRelatedPagesAction(input: {
  groupId: string;
  pageIds: string[];
}): Promise<GroupHomepageActionResult> {
  const admin = await getActionAdmin();
  if (!admin.ok) return { ok: false, error: admin.error };

  const parsed = relatedPagesSchema.safeParse(input);
  if (!parsed.success || new Set(parsed.data.pageIds).size !== parsed.data.pageIds.length) {
    return { ok: false, error: "关联页面列表无效。" };
  }

  const supabase = createRequiredServiceClient();
  const { error } = await supabase.rpc("set_contest_group_pages", {
    p_contest_group_id: parsed.data.groupId,
    p_page_ids: parsed.data.pageIds,
  });
  if (error) return { ok: false, error: error.message };

  refreshGroupHomepage(parsed.data.groupId);
  return { ok: true, message: "关联页面已保存。" };
}
