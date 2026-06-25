# Butter Vote

一个基于 Next.js App Router 和 Supabase 的投票网站，支持活动、活动组、提名审核、图片上传、组内联合投票、真爱票和结果发布。

## 技术栈

- Next.js App Router
- TypeScript
- Tailwind CSS
- shadcn/ui 本地组件
- Supabase PostgreSQL / Auth / Storage
- Server Actions
- Vercel Cron 或其他定时服务

## 本地运行

```bash
npm install
cp .env.example .env.local
npm run dev
```

打开 `http://localhost:3000`。

## 环境变量

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
CRON_SECRET=
BOT_API_SECRET=
APP_SESSION_COOKIE_NAME=app_session
APP_SESSION_DAYS=30
QQ_LOGIN_TICKET_TTL_MINUTES=5
USER_GROUP_MEMBERSHIP_DAYS=7
NEXT_PUBLIC_SITE_URL=
```

`CRON_SECRET` 用于保护定时任务接口。`BOT_API_SECRET` 用于保护 QQ bot 生成登录链接接口。`NEXT_PUBLIC_SITE_URL` 用于拼接完整登录链接，例如 `https://example.com`。`USER_GROUP_MEMBERSHIP_DAYS` 控制 QQ ticket 登录后用户组身份续期天数，默认 7 天。`SUPABASE_SERVICE_ROLE_KEY` 只在服务端使用，不要暴露给前端。

## Supabase 初始化和迁移

新项目依次执行：

```sql
-- Supabase SQL Editor
-- 1. supabase/schema.sql
-- 2. supabase/migrations/202605110001_add_vote_images.sql
-- 3. supabase/migrations/202605110002_groups_love_votes_homepage.sql
-- 4. supabase/migrations/202605120001_operation_enhancements.sql
-- 5. supabase/migrations/202605120002_fix_scheduled_transition_execution.sql
-- 6. supabase/migrations/202605120003_qq_bot_login.sql
-- 7. supabase/migrations/202605120004_nomination_visibility_and_description_limit.sql
-- 8. supabase/migrations/202605120005_delete_group_set_null.sql
-- 9. supabase/migrations/202605140001_allow_past_scheduled_transition_run_at.sql
-- 10. supabase/migrations/202605140002_add_contest_love_vote_enabled.sql
-- 11. supabase/migrations/202605140003_user_group_access_control.sql
-- 12. supabase/migrations/202605140004_launch_hardening_indexes_and_atomic_votes.sql
-- 13. 可选：supabase/seed.sql
```

已有项目只需继续执行最新 migration：

```sql
supabase/migrations/202605120001_operation_enhancements.sql
supabase/migrations/202605120002_fix_scheduled_transition_execution.sql
supabase/migrations/202605120003_qq_bot_login.sql
supabase/migrations/202605120004_nomination_visibility_and_description_limit.sql
supabase/migrations/202605120005_delete_group_set_null.sql
supabase/migrations/202605140001_allow_past_scheduled_transition_run_at.sql
supabase/migrations/202605140002_add_contest_love_vote_enabled.sql
supabase/migrations/202605140003_user_group_access_control.sql
supabase/migrations/202605140004_launch_hardening_indexes_and_atomic_votes.sql
```

这些迁移新增活动运营设置、提名者信息、候选项软删除、定时状态转换表、QQ bot 登录表、用户组访问控制、结果可见性 RPC 和相关 RLS policy。
`202605140004_launch_hardening_indexes_and_atomic_votes.sql` 额外补充上线索引、对齐 `vote-images` bucket 限制，并新增仅授权给 `service_role` 的原子投票 / 组内投票 / 提名审核 RPC。浏览器端不应直接调用这些 RPC，所有写入仍必须走 Server Action 或 Route Handler。

## QQ Bot 一次性链接登录

QQ 登录不接 QQ OAuth，也不把 QQ 身份塞进 Supabase Auth。QQ 身份只能由 bot 后端带 `BOT_API_SECRET` 调用网站接口传入，网站生成短期一次性 token，数据库只保存 `token_hash`。用户点击链接后，网站按 `qq_user_id` 查找或创建 `profiles` 记录，创建自建 `app_sessions`，并设置 HttpOnly `app_session` cookie。

Bot 请求登录链接：

```bash
curl -X POST https://your-site.com/api/bot/qq-login-link \
  -H "Authorization: Bearer YOUR_BOT_API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "qqUserId": "123456789",
    "qqNickname": "测试用户",
    "qqAvatarUrl": "https://example.com/avatar.jpg",
    "returnTo": "/groups/GROUP_ID/vote",
    "userGroupJoinCodes": ["qq_group_123456"]
  }'
```

返回：

```json
{
  "url": "https://your-site.com/auth/qq-ticket?token=xxxx"
}
```

用户打开链接后会先看到 QQ 登录确认页；点击“继续登录”后，网站才会消费一次性 token、自动注册或登录，并跳转到 `returnTo`。这样可以避免 QQ 客户端预览或安全扫描提前把链接标记为已使用。`returnTo` 只允许 `/`、`/contests/...`、`/groups/...`、`/me/...` 这类站内路径。同一个 `qq_user_id` 再次登录会复用同一个 profile，并创建新的 app session。

`userGroupJoinCodes` 可选。生成 ticket 时不会要求 join_code 已存在；用户点击链接完成登录后，网站会按 ticket 携带的 join_code 查找用户组，并加入或续期对应成员身份。有效期由 `USER_GROUP_MEMBERSHIP_DAYS` 控制。本次 ticket 只续期携带的用户组，用户已有的其他用户组不会被续期；如果用户离开某 QQ 群，只要不再通过该群 ticket 登录，该用户组权限会在 `expires_at` 后失效。

安全注意事项：

- 登录链接默认 5 分钟过期，只能使用一次。
- 数据库只保存登录 token 和 session token 的 SHA-256 hash。
- 不要泄露 `BOT_API_SECRET`。
- 不要在前端使用 `SUPABASE_SERVICE_ROLE_KEY`。
- QQ app session 不是 Supabase Auth session，RLS 里的 `auth.uid()` 无法识别 QQ 用户；提名、投票、真爱票、图片上传和后台写入都应走 Server Actions 或 Route Handlers，在服务端显式校验权限。

## QQ 登录手动测试

1. 设置 `.env.local` 中的 Supabase、`SUPABASE_SERVICE_ROLE_KEY`、`BOT_API_SECRET`、`NEXT_PUBLIC_SITE_URL` 等环境变量。
2. 执行 `supabase/migrations/202605120003_qq_bot_login.sql` 和 `supabase/migrations/202605140003_user_group_access_control.sql`。
3. 启动 `npm run dev`。
4. 在 `/admin/user-groups` 创建用户组，并设置 `join_code = qq_group_123456`。
5. 用上面的 `curl` 调用 `/api/bot/qq-login-link`。
6. 复制返回的 `url` 到浏览器打开。
7. 确认自动创建 `profiles.qq_user_id = 123456789` 的 profile。
8. 点击确认页的“继续登录”，确认页面进入登录态并跳转到 `returnTo`。
9. 在 `/me/groups` 确认用户已加入或续期 `qq_group_123456` 对应用户组。
10. 再次调用接口生成新链接，确认同一个 `qq_user_id` 登录到同一个 profile。
11. 再次打开旧链接，确认提示链接已被使用或无效。
12. 将 ticket 过期时间改到过去，确认过期链接不能登录。
13. 退出登录，确认 `app_session` cookie 被清除且对应 `app_sessions.revoked_at` 被写入。
14. 用原邮箱密码登录，确认 Supabase Auth 登录仍然可用。

## 定时状态转换

接口：

```text
GET /api/cron/apply-scheduled-transitions
Authorization: Bearer ${CRON_SECRET}
```

Vercel Cron 或其他定时服务按需调用该接口即可。活动详情页、投票页、结果页也会在服务端加载时尝试执行一次到期转换，方便本地开发。

## 常用命令

```bash
npm run dev
npm run typecheck
npm run build
```

## 上线前检查清单

### 必需环境变量

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`，仅服务端配置，不能加 `NEXT_PUBLIC_`
- `BOT_API_SECRET`，仅服务端和 QQ bot 后端使用
- `CRON_SECRET`，仅服务端和定时任务 Worker 使用
- `NEXT_PUBLIC_SITE_URL`
- `APP_SESSION_COOKIE_NAME`
- `APP_SESSION_DAYS`
- `QQ_LOGIN_TICKET_TTL_MINUTES`
- `USER_GROUP_MEMBERSHIP_DAYS`

### Supabase

- 已执行全部 migration，尤其是 `202605140004_launch_hardening_indexes_and_atomic_votes.sql`
- `profiles`、`contests`、`nominations`、`candidates`、`votes`、`contest_groups`、`love_vote_allocations`、`qq_login_tickets`、`app_sessions` 已启用 RLS
- `qq_login_tickets` 和 `app_sessions` 不向 `anon` / `authenticated` 开放读写
- `vote-images` bucket 存在，允许 MIME 仅包含 `image/webp`、`image/jpeg`
- 邮箱注册/验证策略符合预期
- 已手动确认管理员账号 `profiles.role = 'admin'`

### 部署平台

- Cloudflare / Vercel 环境变量已配置完成，secret 不写入前端变量
- Cron 已配置到 `/api/cron/apply-scheduled-transitions`，请求头为 `Authorization: Bearer ${CRON_SECRET}`
- HTTPS、自定义域名、`NEXT_PUBLIC_SITE_URL` 与 cookie secure 行为正常
- 响应头包含 CSP、`X-Frame-Options`、`X-Content-Type-Options`、`Referrer-Policy`、`Permissions-Policy`，生产环境包含 HSTS
- 上线后用普通用户和管理员分别测试投票、提名、审核、组内投票、真爱票、QQ bot 登录、邮箱登录、退出登录

## 管理员设置

先注册一个账号，然后在 Supabase SQL Editor 执行：

```sql
update public.profiles
set role = 'admin'
where email = 'you@example.com';
```

## 开源协议与署名

Butter Vote 源代码基于 GNU Affero General Public License version 3.0 only（AGPL-3.0-only）发布。修改版如果作为网络服务对外提供，需要按照 AGPL-3.0 向网络用户提供对应源码。完整协议见 `LICENSE`。

项目原始署名见 `NOTICE`。Butter Vote 名称、logo 和品牌资产不随源代码许可证授权，使用规则见 `TRADEMARKS.md`。
