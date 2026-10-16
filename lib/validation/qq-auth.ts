import { z } from "zod";

export const qqNumberSchema = z.string().trim().regex(/^[1-9][0-9]{4,11}$/, "请输入有效的数字 QQ 号。");
export const qqEmailSendSchema = z.object({ qq: qqNumberSchema });
export const qqEmailVerifySchema = qqEmailSendSchema.extend({
  code: z.string().trim().regex(/^\d{8}$/, "请输入 8 位验证码。"),
  returnTo: z.string().max(2000).optional(),
});
export function qqEmailAddress(qq: string) {
  return `${qqNumberSchema.parse(qq)}@qq.com`;
}

export const rosterMemberSchema = z.object({
  qq_user_id: qqNumberSchema,
  nickname: z.string().max(120),
  card: z.string().max(120),
});
export const rosterResultSchema = z.object({
  leaseId: z.string().uuid(),
  members: z.array(rosterMemberSchema).min(1).max(10000).optional(),
  error: z.enum(["bot_unavailable", "incomplete_roster", "group_not_allowed"]).optional(),
}).refine((value) => Boolean(value.members) !== Boolean(value.error), "请提交完整名单或失败原因。");
