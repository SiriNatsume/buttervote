import { z } from "zod";

export const siteNavigationSettingsSchema = z.object({
  resultsGroupId: z.string().uuid().nullable(),
  resultsContestId: z.string().uuid().nullable().optional(),
  resultsGroupIds: z.array(z.string().uuid()).optional(),
  resultsContestIds: z.array(z.string().uuid()).optional(),
  nominationContestId: z.string().uuid().nullable().default(null),
}).refine((value) => !value.resultsGroupId || !value.resultsContestId, {
  message: "赛程结果只能设置一个默认入口。",
});

export const siteNavigationFormSchema = z.object({
  resultsGroupId: z.union([z.string().uuid(), z.literal("none")]),
  resultsContestId: z.union([z.string().uuid(), z.literal("none")]).default("none"),
  nominationContestId: z.union([z.string().uuid(), z.literal("none")]),
}).refine((value) => value.resultsGroupId === "none" || value.resultsContestId === "none", {
  message: "赛程结果只能设置一个默认入口。",
});
