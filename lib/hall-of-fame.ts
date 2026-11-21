import { sitePageHref } from "./site-pages";
import type { SitePage } from "./types";

export function getHallOfFameJourneyHref(
  entry: { contest_group_id: string | null; page_id: string | null },
  page?: Pick<SitePage, "id" | "slug" | "visibility">,
) {
  if (entry.contest_group_id) return `/groups/${entry.contest_group_id}`;
  if (!page || page.id !== entry.page_id || page.visibility !== "public") return null;
  return sitePageHref(page.slug);
}

export const HALL_OF_FAME_BUCKET = "hall-of-fame-posters";
export const HALL_OF_FAME_MAX_FILE_SIZE = 20 * 1024 * 1024;
export const HALL_OF_FAME_THUMBNAIL_MAX_FILE_SIZE = 320 * 1024;
export const HALL_OF_FAME_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export const HALL_OF_FAME_THUMBNAIL_TYPES = [
  "image/jpeg",
  "image/webp",
] as const;

export function getHallOfFamePosterUrl(path?: string | null) {
  if (!path) return null;

  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  if (!baseUrl) return null;

  return `${baseUrl}/storage/v1/object/public/${HALL_OF_FAME_BUCKET}/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}
