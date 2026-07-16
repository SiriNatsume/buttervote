"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActionAdmin } from "@/lib/auth";
import { createRequiredServiceClient } from "@/lib/supabase/service";

const visibilityInput = z.object({
  assetId: z.string().uuid(),
  visibility: z.enum(["admin_only", "public"]),
});

export async function setPageAssetVisibilityAction(input: {
  assetId: string;
  visibility: "admin_only" | "public";
}) {
  const admin = await getActionAdmin();
  if (!admin.ok) return { ok: false as const, error: admin.error };
  const parsed = visibilityInput.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "附件数据无效。" };

  const supabase = createRequiredServiceClient();
  const { error } = await supabase
    .from("page_assets")
    .update({ visibility: parsed.data.visibility })
    .eq("id", parsed.data.assetId);
  if (error) {
    console.error(`[page-assets] visibility update failed: ${error.message}`);
    return { ok: false as const, error: "附件可见性更新失败。" };
  }

  revalidatePath("/admin/assets");
  return { ok: true as const };
}
