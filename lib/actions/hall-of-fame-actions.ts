"use server";

import { revalidatePath } from "next/cache";
import { getActionAdmin } from "@/lib/auth";
import { HALL_OF_FAME_BUCKET } from "@/lib/hall-of-fame";
import { createRequiredServiceClient } from "@/lib/supabase/service";

type HallOfFameActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

function refreshHallOfFame() {
  revalidatePath("/hall-of-fame");
  revalidatePath("/admin");
  revalidatePath("/admin/hall-of-fame");
}

export async function reorderHallOfFameEntriesAction(
  entryIds: string[],
): Promise<HallOfFameActionResult> {
  const admin = await getActionAdmin();
  if (!admin.ok) return { ok: false, error: admin.error };

  if (!Array.isArray(entryIds) || entryIds.some((id) => typeof id !== "string")) {
    return { ok: false, error: "排序数据无效。" };
  }

  const supabase = createRequiredServiceClient();
  const { error } = await supabase.rpc("reorder_hall_of_fame_entries", {
    p_entry_ids: entryIds,
  });

  if (error) return { ok: false, error: error.message };

  refreshHallOfFame();
  return { ok: true, message: "排序已保存。" };
}

export async function deleteHallOfFameEntryAction(
  entryId: string,
): Promise<HallOfFameActionResult> {
  const admin = await getActionAdmin();
  if (!admin.ok) return { ok: false, error: admin.error };

  const supabase = createRequiredServiceClient();
  const { data: entry, error: lookupError } = await supabase
    .from("hall_of_fame_entries")
    .select("id,poster_path")
    .eq("id", entryId)
    .maybeSingle();

  if (lookupError) return { ok: false, error: lookupError.message };
  if (!entry) return { ok: false, error: "冠军英灵殿条目不存在。" };

  const { error: deleteError } = await supabase
    .from("hall_of_fame_entries")
    .delete()
    .eq("id", entry.id);

  if (deleteError) return { ok: false, error: deleteError.message };

  const { error: storageError } = await supabase.storage
    .from(HALL_OF_FAME_BUCKET)
    .remove([entry.poster_path]);

  refreshHallOfFame();
  if (storageError) {
    return {
      ok: false,
      error: `条目已删除，但海报文件清理失败：${storageError.message}`,
    };
  }

  return { ok: true, message: "冠军英灵殿条目已删除。" };
}
