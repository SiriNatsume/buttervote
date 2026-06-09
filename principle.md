# Butter Vote 开发原则

本文档供后续维护 Butter Vote 的 agent 和开发者查阅。项目是 Next.js App Router + TypeScript + Supabase + shadcn/ui 投票网站，任何改动都必须优先保护投票、提名、活动组、真爱票、QQ bot 登录、邮箱登录和管理后台的既有业务语义。

## 总原则

- 先审计，再修改。先读现有代码、路由、Server Action、数据库 migration 和组件用法，再做小而确定的修复。
- 不重写项目，不大规模重构，不引入重型依赖，不为了性能牺牲权限校验。
- 所有 UI 文案保持中文，视觉风格保持 Butter Vote 的奶油黄、暖橙、柔和边框和圆角风格。
- 修改应尽量局部、可回滚、可验证。高风险业务改动优先做成建议或 migration，不要暗中改变主表语义。
- 写入路径必须端到端验证：前端防重复提交，服务端重新校验身份和权限，数据库用约束/RPC 兜底。

## 安全原则

- `SUPABASE_SERVICE_ROLE_KEY` 只能在服务端使用，绝不能进入 Client Component、浏览器 bundle 或 `NEXT_PUBLIC_` 环境变量。
- `BOT_API_SECRET`、`CRON_SECRET` 只能在服务端或 Worker secret 中使用，不能暴露给前端。
- service role client 只能在 `server-only` 文件、Route Handler、Server Action、Server Component 中使用。
- 管理员操作必须先通过 `requireAdmin()` 或等价服务端校验，普通用户操作必须通过 `requireUser()` 或等价服务端校验。
- Server Action 不得信任前端传来的 `userId`、`profileId`、`role`，必须从当前 session / app session 重新获取用户。
- QQ bot 登录必须只存 `token_hash`，app session 必须只存 `session_token_hash`，不能记录明文 token。
- 一次性登录 token 必须短有效期、只能使用一次，`returnTo` 必须限制为站内路径。
- `app_session` cookie 必须设置 `httpOnly`、生产环境 `secure`、`sameSite=lax`、`path=/`。
- logout 必须撤销当前 `app_session`，并清除 cookie。
- 如果 QQ 登录用户不经过 Supabase Auth，敏感业务写入必须走 Server Action 或 Route Handler，不能让浏览器直接写 `votes`、`nominations`、`candidates` 等表。
- RLS 不能误开放管理数据。即使使用 service role 绕过 RLS，也必须在服务端显式做权限判断。
- secret 比较优先使用 timing-safe 比较。
- 不要在日志里打印明文 token、secret、cookie、登录链接或敏感 payload。

## 权限原则

以下操作必须在服务端校验权限：

- 创建、编辑、删除活动。
- 创建、编辑、删除活动组。
- 创建、编辑、删除候选项。
- 审核、批量审核提名。
- 修改活动状态和定时任务。
- 修改首页 Hero。
- 提交投票、组内投票、使用真爱票。
- 上传图片和更新图片元数据。
- 修改自己的提名。
- 管理用户组、成员和活动组访问权限。

管理员功能必须只对 `role = "admin"` 开放。普通用户不能通过构造请求访问管理 Server Action。

## 输入校验原则

- 表单和接口输入必须使用 zod 或等价校验。
- `title`、`name` 等关键字段必须非空并限制长度。
- `description` 必须限制最大长度，并遵循活动配置的候选项简介限制。
- `vote_type`、`status`、`closed_result_visibility`、`access_mode` 等字段必须使用枚举。
- `max_choices`、真爱票额度、权重等数字字段必须校验范围。
- 时间字段必须解析为合法 ISO 时间，并明确处理空值。
- `returnTo` 只能允许站内安全路径。
- `image_path` 必须匹配受控路径，不能允许任意外链或任意覆盖。
- `loveCandidateIds` 必须属于当前活动候选项，并且必须包含在本次已选择候选项中。

## 图片上传原则

- 原图只允许 `jpg/jpeg/png/webp` 进入浏览器裁剪流程，不允许 svg、gif。
- 最终上传只允许 WebP 或 JPEG，服务端应校验 MIME 和文件签名。
- 限制原图大小和最终输出大小，不存 base64。
- Storage path 必须由服务端约定或受控逻辑生成，例如：
  - `contests/{contestId}/cover.webp`
  - `groups/{groupId}/cover.webp`
  - `candidates/{candidateId}/image.webp`
  - `nominations/{nominationId}/image.webp`
  - `homepage/hero.webp`
- 图片元数据更新必须重新校验当前用户是否有权限修改对应资源。
- 候选项、封面、结果图应设置稳定容器尺寸，避免布局跳动。

## 投票和提名写入原则

- 投票前必须校验活动存在、状态为 `voting`、投票类型匹配、候选项属于当前活动。
- 已投票用户不能重复投票，数据库必须有 `votes(contest_id, voter_id)` 唯一约束。
- 组内投票必须校验所有活动属于当前活动组。
- 真爱票必须校验活动开启、组配置有效、候选项合法、额度未超。
- 投票 + 真爱票写入应使用数据库事务/RPC 原子完成，避免部分写入。
- 审核提名时，插入候选项和更新提名状态应原子完成，避免候选项已生成但提名仍 pending。
- 管理员批量操作应检查所有目标仍处于可操作状态，避免部分成功造成 UI 与数据不一致。

## 结果可见性原则

- 结果页不能向普通用户泄露未公开票数。
- 普通用户只有在以下情况可看结果：
  - 活动 `published`。
  - 活动 `closed` 且 `closed_result_visibility = "public"`。
  - 活动 `voting` 且 `live_results_enabled = true`。
- 管理员可查看完整结果和非 active 候选项历史。
- 结果未公开时，页面只能显示明确中文提示，不能渲染票数、排名、真爱票统计。

## UI 与交互原则

- 关键提交按钮必须有 loading 状态，pending 时禁用，防止重复提交。
- 成功和失败都要有明确中文 toast 或页面提示。
- 主要空状态必须清楚，例如没有活动、没有活动组、没有候选项、没有可投票活动、没有可提名活动、没有可查看结果、没有搜索结果。
- 已投票后再次进入投票页，不显示投票表单，只显示已投票提示和返回入口。
- 已归档、已结束、等待开始、结果未公开、无权限等状态必须有明确提示。
- 管理后台移动端要可用。表格在手机端优先提供 card 替代，按钮不能溢出。
- Dialog、图片裁剪、批量操作面板必须在手机端可操作。
- 不要把服务端组件无必要改成客户端组件。
- 不要在页面里写解释产品功能的营销式大段文案。用户进入页面应直接完成任务。

## 业务表单提交原则

业务按钮和后台表单不能让 Server Action 的 `redirect()` 泄漏到用户交互中。网络不好、Supabase Auth 抖动、权限失效或校验失败时，应停留当前页面并显示中文 toast，而不是跳到首页、登录页或出现 `NEXT_REDIRECT`。

适用场景：

- 创建、保存、删除、恢复、审核、批量操作、成员续期/撤销、图片元数据保存、定时任务创建/删除等业务按钮。
- 不需要浏览器原生整页提交的后台表单和用户表单。
- 成功后只需要 toast、局部刷新、`router.refresh()` 或跳到明确新资源页的操作。

默认组件写法：

```tsx
import { TransitionActionForm } from "@/components/transition-action-form";
import { FormStatusFieldset } from "@/components/form-status-fieldset";
import { FormSubmitButton } from "@/components/form-submit-button";

<TransitionActionForm action={saveThingAction} successMessage="已保存">
  <FormStatusFieldset className="space-y-4">
    <input type="hidden" name="thingId" value={thing.id} />
    {/* fields */}
    <FormSubmitButton loadingText="保存中...">保存</FormSubmitButton>
  </FormStatusFieldset>
</TransitionActionForm>
```

如果成功后要跳到新页面，Server Action 返回 `redirectTo`，不要调用 `redirect()`：

```ts
return {
  ok: true,
  message: "活动已创建",
  redirectTo: `/admin/contests/${contest.id}/edit`,
};
```

Server Action 默认返回结构化结果：

```ts
type ActionResult =
  | { ok: true; message?: string; redirectTo?: string; refresh?: boolean }
  | { ok: false; error: string };
```

管理员业务 action 应使用 `getActionAdmin()`，普通用户业务 action 应使用 `getActionUser()`。不要在这类 action 里直接使用 `requireAdmin()` / `requireUser()`，因为它们会通过 `redirect()` 做页面级保护，网络抖动时容易变成业务按钮跳页。

```ts
export async function saveThingAction(formData: FormData): Promise<ActionResult> {
  const adminResult = await getActionAdmin();
  if (!adminResult.ok) {
    return { ok: false, error: adminResult.error };
  }

  const parsed = schema.safeParse({
    name: formData.get("name"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "信息无效。" };
  }

  // 服务端重新校验权限和写入数据。
  revalidatePath("/admin");
  return { ok: true, message: "已保存" };
}
```

非 `<form>` 场景，例如下拉切换、批量面板、自定义投票提交，可以使用 `useTransition` 或本地 `isSubmitting`，但必须遵循同样返回约定：

- pending 时禁用按钮或控件。
- `result.ok === false` 时 `toast.error(result.error)`。
- 成功时 `toast.success(result.message ?? "操作成功")`。
- 需要刷新数据时调用 `router.refresh()`。
- 不把服务端 `redirect()` 当作普通业务成功或失败路径。

允许继续使用 `redirect()` 的例外：

- Server Component 页面级路由保护，例如直接访问后台页面时 `requireAdmin()`。
- 登录、注册、退出、QQ ticket 等认证导航流程。
- Route Handler 明确需要返回 `NextResponse.redirect()` 的认证或协议跳转。
- 页面发现资源不存在或状态不允许访问时跳到详情页，例如投票页活动不可投时返回活动页。

新增业务功能时，检查清单：

- 页面或组件是否用了 `TransitionActionForm`，而不是原生 `<form action={action}>`。
- Server Action 是否返回 `{ ok, error/message }`，而不是直接 `redirect()`。
- 权限是否仍在服务端校验，不能只靠前端隐藏按钮。
- 网络失败时是否会 toast “网络连接不稳定，请稍后再试。”。
- 成功后是否只做必要的 `router.refresh()` 或明确 `redirectTo`。

## 性能原则

- 避免 `select("*")`，页面只查询实际需要字段。
- 常用页面优先精简字段：首页、活动详情、活动组详情、投票页、结果页、管理后台。
- 避免重复查询同一个 profile、contest、group、votes、candidates。能合并时合并。
- 小操作优先本地更新或 `router.refresh()`，不要无意义 redirect 当前页。
- 图片使用压缩图和固定比例容器。非首屏图片不要设置 priority。
- 慢页面应提供 `loading.tsx` 或明确 skeleton/loading 状态。
- 数据库索引用 `create index if not exists`，避免重复创建和破坏已有环境。

## 稳定性原则

- middleware 中的 Supabase Auth 请求必须 try/catch，网络失败不能打崩页面。
- middleware matcher 不应匹配静态资源。
- 页面 render 中调用定时状态转换时不得 revalidate；cron route 才可以 revalidate。
- `applyScheduledTransitions` 默认不 revalidate。
- 设置 `voting_starts_at` / `voting_ends_at` 时必须同步 scheduled transition。
- 过期 `voting_ends_at` 不应在投票中状态下继续展示为有效截止时间。
- Supabase 查询错误不能被无声吞掉；管理后台应显示可理解错误或抛出明确错误。
- Cron 和 fallback 路径需要可观测日志，但不能打印 secret。

## 上线配置原则

上线前必须确认：

- 必需环境变量已配置：`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`BOT_API_SECRET`、`CRON_SECRET`、`NEXT_PUBLIC_SITE_URL`、`APP_SESSION_COOKIE_NAME`、`APP_SESSION_DAYS`、`QQ_LOGIN_TICKET_TTL_MINUTES`。
- Supabase migration 已执行，RLS policy 已启用并符合预期。
- `vote-images` bucket 存在，Storage policy 正确。
- 邮箱注册策略符合预期，管理员账号已正确设置。
- Cron 配置完成，HTTPS 和自定义域名正常。
- 安全响应头正常，CSP 不应过严导致 Supabase、Storage 图片、样式或脚本失效。

## 验证原则

每次上线前至少运行：

```bash
npm run typecheck
npm run build
```

关键手动测试：

- 邮箱注册、邮箱登录、退出登录。
- QQ bot 一次性链接登录、旧链接不可复用、过期链接不可用。
- 普通用户提名、编辑待审核提名、上传图片。
- 管理员审核、批量审核、创建/编辑活动和活动组。
- 单选、多选、排名投票。
- 组内投票和真爱票额度校验。
- 结果未公开时普通用户不可见票数，公开后可见。
- 普通用户不能访问管理后台和管理操作。
- 定时任务能正常执行状态转换。

## Cloudflare Worker SSR 原则

- 首页、活动组联合投票页、结果页、对阵图等公开 Server Component 不能在渲染期按比赛/候选逐项 fan-out 发起大量 Supabase 请求；需要优先批量查询、分页聚合或复用已有结果，避免触发 Cloudflare Worker SSR subrequest/运行时限制。
- 对阵图等可选展示模块遇到比分或辅助数据加载失败时，必须降级为不展示该辅助信息，但仍保持页面可渲染，不能抛出导致 `Application error` / digest 的服务端异常。
- 上线后验证不能只看 HTTP 200；涉及 Server Component 流式渲染的页面，需要检查 HTML/RSC 中没有 Next error digest，并确认关键模块内容实际渲染出来。
