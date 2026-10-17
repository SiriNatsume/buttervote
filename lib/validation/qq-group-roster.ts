import { z } from "zod";
import { qqNumberSchema } from "@/lib/validation/qq-auth";

export const removeQQGroupRosterSchema = z.object({
  userGroupId: z.string().uuid(),
  mode: z.enum(["selected", "all"]),
  qqUserIds: z.array(qqNumberSchema).max(10000).transform((ids) => [...new Set(ids)]),
}).refine((value) => value.mode === "all" ? value.qqUserIds.length === 0 : value.qqUserIds.length > 0,
  "请选择需要移除的匹配条目。");
