import { z } from "zod";

const optionalUuid = (message: string) =>
  z.preprocess(
    (value) => {
      if (value === null || value === undefined) return null;
      if (typeof value !== "string") return value;
      const normalized = value.trim();
      return normalized.length > 0 ? normalized : null;
    },
    z.string().uuid(message).nullable(),
  );

export const hallOfFameEntryInputSchema = z.object({
  entryId: optionalUuid("名人堂条目 ID 无效。"),
  contestId: optionalUuid("关联活动 ID 无效。"),
  eventTitle: z
    .string()
    .trim()
    .min(1, "赛事标题不能为空。")
    .max(120, "赛事标题不能超过 120 个字符。"),
  winnerName: z
    .string()
    .trim()
    .min(1, "胜者名不能为空。")
    .max(120, "胜者名不能超过 120 个字符。"),
  description: z
    .string()
    .trim()
    .max(200, "简介不能超过 200 个字符。"),
});

export const hallOfFameEntryIdSchema = z
  .string()
  .uuid("名人堂条目 ID 无效。");

export const hallOfFameOrderSchema = z
  .array(z.string().uuid("排序中包含无效的条目 ID。"))
  .min(1, "排序数据不能为空。")
  .max(500, "一次最多调整 500 个条目。")
  .refine((entryIds) => new Set(entryIds).size === entryIds.length, {
    message: "排序数据包含重复条目。",
  });

export function getValidationMessage(error: z.ZodError) {
  return error.issues[0]?.message ?? "提交的数据无效。";
}
