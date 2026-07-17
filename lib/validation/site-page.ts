import { z } from "zod";
import {
  pageVisibilities,
  SITE_PAGE_CONTENT_MAX_LENGTH,
  SITE_PAGE_DESCRIPTION_MAX_LENGTH,
  SITE_PAGE_SLUG_MAX_LENGTH,
  SITE_PAGE_TITLE_MAX_LENGTH,
} from "@/lib/site-pages";

export const sitePageInputSchema = z.object({
  pageId: z.string().uuid().optional(),
  title: z
    .string()
    .trim()
    .min(1, "页面标题不能为空。")
    .max(SITE_PAGE_TITLE_MAX_LENGTH, `页面标题不能超过 ${SITE_PAGE_TITLE_MAX_LENGTH} 字。`),
  description: z
    .string()
    .trim()
    .max(
      SITE_PAGE_DESCRIPTION_MAX_LENGTH,
      `页面摘要不能超过 ${SITE_PAGE_DESCRIPTION_MAX_LENGTH} 字。`,
    )
    .optional(),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Slug 不能为空。")
    .max(SITE_PAGE_SLUG_MAX_LENGTH, `Slug 不能超过 ${SITE_PAGE_SLUG_MAX_LENGTH} 字符。`)
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Slug 只能包含小写字母、数字和单个连字符。",
    ),
  contentMarkdown: z
    .string()
    .max(
      SITE_PAGE_CONTENT_MAX_LENGTH,
      `Markdown 不能超过 ${SITE_PAGE_CONTENT_MAX_LENGTH} 字符。`,
    ),
  visibility: z.enum(pageVisibilities),
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
});

export type SitePageInput = z.infer<typeof sitePageInputSchema>;

export function firstValidationMessage(error: z.ZodError) {
  return error.issues[0]?.message ?? "页面数据无效。";
}
