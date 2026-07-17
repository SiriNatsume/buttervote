import type { PageVisibility } from "@/lib/types";

export const pageVisibilities = ["admin_only", "public"] as const;

export const pageVisibilityLabel: Record<PageVisibility, string> = {
  admin_only: "管理可见",
  public: "所有人可见",
};

export const SITE_PAGE_TITLE_MAX_LENGTH = 160;
export const SITE_PAGE_DESCRIPTION_MAX_LENGTH = 500;
export const SITE_PAGE_SLUG_MAX_LENGTH = 120;
export const SITE_PAGE_CONTENT_MAX_LENGTH = 1_000_000;

export function sitePageHref(slug: string) {
  return `/pages/${slug}`;
}
