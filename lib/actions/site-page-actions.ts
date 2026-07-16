"use server";

import { revalidatePath } from "next/cache";
import { getActionAdmin } from "@/lib/auth";
import { createRequiredServiceClient } from "@/lib/supabase/service";
import { sitePageHref } from "@/lib/site-pages";
import {
  firstValidationMessage,
  sitePageInputSchema,
  type SitePageInput,
} from "@/lib/validation/site-page";

export type SitePageActionResult =
  | {
      ok: true;
      pageId: string;
      slug: string;
      updatedAt: string;
      redirectTo: string;
      warning?: string;
    }
  | { ok: false; error: string; conflict?: boolean };

const assetReferencePattern =
  /\/api\/page-assets\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/gi;

function referencedAssetIds(markdown: string) {
  return Array.from(markdown.matchAll(assetReferencePattern), (match) => match[1]);
}

async function hiddenAssetWarning(markdown: string, visibility: string) {
  if (visibility !== "public") return undefined;
  const assetIds = [...new Set(referencedAssetIds(markdown))];
  if (assetIds.length === 0) return undefined;

  const supabase = createRequiredServiceClient();
  const { count } = await supabase
    .from("page_assets")
    .select("id", { count: "exact", head: true })
    .in("id", assetIds)
    .eq("visibility", "admin_only");

  return count
    ? `页面引用了 ${count} 个“管理可见”附件，普通用户将无法读取这些附件。`
    : undefined;
}

function databaseErrorMessage(error: { code?: string; message: string }) {
  if (error.code === "23505") return "该 Slug 已被其他页面使用。";
  if (error.message.includes("已被活动组关联")) {
    return "该页面已被活动组关联，请先解除关联后再修改为管理可见。";
  }
  return "保存页面失败，请稍后重试。";
}

export async function createSitePageAction(
  input: SitePageInput,
): Promise<SitePageActionResult> {
  const admin = await getActionAdmin();
  if (!admin.ok) return { ok: false, error: admin.error };

  const parsed = sitePageInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: firstValidationMessage(parsed.error) };
  }

  const value = parsed.data;
  const supabase = createRequiredServiceClient();
  const { data, error } = await supabase
    .from("site_pages")
    .insert({
      title: value.title,
      description: value.description || null,
      slug: value.slug,
      content_markdown: value.contentMarkdown,
      visibility: value.visibility,
      created_by: admin.profile.id,
      updated_by: admin.profile.id,
    })
    .select("id,slug,updated_at")
    .single();

  if (error || !data) {
    if (error) console.error(`[site-pages] create failed: ${error.message}`);
    return {
      ok: false,
      error: databaseErrorMessage(error ?? { message: "No inserted page returned." }),
    };
  }

  const warning = await hiddenAssetWarning(
    value.contentMarkdown,
    value.visibility,
  );
  revalidatePath("/admin/pages");
  revalidatePath(sitePageHref(data.slug));
  return {
    ok: true,
    pageId: data.id,
    slug: data.slug,
    updatedAt: data.updated_at,
    redirectTo: `/admin/pages/${data.id}/edit`,
    warning,
  };
}

export async function updateSitePageAction(
  input: SitePageInput,
): Promise<SitePageActionResult> {
  const admin = await getActionAdmin();
  if (!admin.ok) return { ok: false, error: admin.error };

  const parsed = sitePageInputSchema.safeParse(input);
  if (!parsed.success || !parsed.data.pageId || !parsed.data.expectedUpdatedAt) {
    return {
      ok: false,
      error: parsed.success
        ? "页面 ID 或并发校验时间缺失。"
        : firstValidationMessage(parsed.error),
    };
  }

  const value = parsed.data;
  const pageId = value.pageId;
  const expectedUpdatedAt = value.expectedUpdatedAt;
  if (!pageId || !expectedUpdatedAt) {
    return { ok: false, error: "页面 ID 或并发校验时间缺失。" };
  }
  const supabase = createRequiredServiceClient();
  const { data: existing, error: lookupError } = await supabase
    .from("site_pages")
    .select("id,slug,updated_at")
    .eq("id", pageId)
    .maybeSingle();

  if (lookupError) {
    console.error(`[site-pages] lookup failed: ${lookupError.message}`);
    return { ok: false, error: "读取页面失败，请稍后重试。" };
  }
  if (!existing) return { ok: false, error: "页面不存在。" };
  if (existing.updated_at !== expectedUpdatedAt) {
    return {
      ok: false,
      conflict: true,
      error: "页面已被其他管理员更新，请刷新页面后重新确认内容。",
    };
  }

  // SECURITY CRITICAL: updated_at participates in the UPDATE predicate, so a
  // concurrent write between the lookup and mutation cannot be overwritten.
  const { data, error } = await supabase
    .from("site_pages")
    .update({
      title: value.title,
      description: value.description || null,
      slug: value.slug,
      content_markdown: value.contentMarkdown,
      visibility: value.visibility,
      updated_by: admin.profile.id,
    })
    .eq("id", pageId)
    .eq("updated_at", expectedUpdatedAt)
    .select("id,slug,updated_at")
    .maybeSingle();

  if (error) {
    console.error(`[site-pages] update failed: ${error.message}`);
    return { ok: false, error: databaseErrorMessage(error) };
  }
  if (!data) {
    return {
      ok: false,
      conflict: true,
      error: "页面已被其他管理员更新，请刷新页面后重新确认内容。",
    };
  }

  const warnings = [
    existing.slug !== data.slug ? "Slug 已修改，旧页面链接已经失效。" : null,
    await hiddenAssetWarning(value.contentMarkdown, value.visibility),
  ].filter((warning): warning is string => Boolean(warning));

  revalidatePath("/admin/pages");
  revalidatePath(sitePageHref(existing.slug));
  const { data: linkedGroups } = await supabase
    .from("contest_group_pages")
    .select("contest_group_id")
    .eq("page_id", data.id);
  for (const relation of linkedGroups ?? []) {
    revalidatePath(`/groups/${relation.contest_group_id}`);
    revalidatePath(`/admin/groups/${relation.contest_group_id}/edit`);
  }
  revalidatePath(sitePageHref(data.slug));
  revalidatePath(`/admin/pages/${data.id}/edit`);

  return {
    ok: true,
    pageId: data.id,
    slug: data.slug,
    updatedAt: data.updated_at,
    redirectTo: `/admin/pages/${data.id}/edit`,
    warning: warnings.join(" ") || undefined,
  };
}
