import { z } from "zod";

export const qqNumberSchema = z.string().trim().regex(/^[1-9][0-9]{4,11}$/, "请输入有效的数字 QQ 号。");
export const qqAccountSchema = z.object({ qq: qqNumberSchema });
export const qqEmailSendSchema = qqAccountSchema.extend({
  purpose: z.enum(["register", "reset"]).default("register"),
});
export const newPasswordSchema = z.string().min(8, "密码至少 8 位。")
  .max(72, "密码不能超过 72 个字节。")
  .refine((value) => new TextEncoder().encode(value).length <= 72, "密码不能超过 72 个字节。");
const sessionFields = {
  remember: z.boolean().default(false),
  returnTo: z.string().max(2000).optional(),
};
export const qqPasswordLoginSchema = qqAccountSchema.extend({
  // Existing password accounts may predate the eight-character registration rule.
  password: z.string().min(1, "请输入密码。").max(1024),
  ...sessionFields,
});
export const qqEmailVerifySchema = qqEmailSendSchema.extend({
  code: z.string().trim().regex(/^\d{8}$/, "请输入 8 位验证码。"),
  password: newPasswordSchema,
  confirmPassword: z.string(),
  ...sessionFields,
}).refine((value) => value.password === value.confirmPassword, {
  message: "两次输入的密码不一致。", path: ["confirmPassword"],
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
