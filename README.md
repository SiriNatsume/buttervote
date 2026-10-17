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

本项目提供与生产环境完全隔离的本地 Supabase。需要 Node.js 22+（本次验证使用 24）、Docker Desktop：

```bash
npm install
npm run setup:local
npm run dev:local
```

打开 `http://localhost:3000`。`setup:local` 会从 `supabase/schema.sql` 和全部 migrations 重建纯本地数据库，创建示例数据与测试账号，并把本地密钥写入被 Git 忽略的 `.local/`。`dev:local` 会优先注入这些本地变量，不修改现有 `.env.local`，并拒绝连接非回环地址的 Supabase。

本地测试账号：

| 角色 | 邮箱 | 密码 |
| --- | --- | --- |
| 管理员 | `admin@buttervote.local` | `ButterVoteAdmin123!` |
| 普通用户 | `user@buttervote.local` | `ButterVoteUser123!` |

Supabase Studio 位于 `http://127.0.0.1:54323`，测试邮件界面位于 `http://127.0.0.1:54324`。常用验证命令：

```bash
npm test
npm run typecheck
npm run build:local
```

开发结束后可以运行 `npm run supabase:local:stop` 停止本地容器；下次使用 `npm run supabase:local:start` 恢复现有本地数据。

完整命令、测试账号和数据库变更流程见 [CONTRIBUTING.md](./CONTRIBUTING.md)。原有 `npm run dev`、`npm run build` 和部署命令保持不变，供已配置托管环境的维护者使用。

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

这些变量用于托管或自定义环境；本地贡献流程会自动生成独立值。`CRON_SECRET` 用于保护定时任务接口。`BOT_API_SECRET` 用于保护 QQ bot 生成登录链接接口。`NEXT_PUBLIC_SITE_URL` 用于拼接完整登录链接，例如 `https://example.com`。`USER_GROUP_MEMBERSHIP_DAYS` 控制 QQ ticket 登录后用户组身份续期天数，默认 7 天。`SUPABASE_SERVICE_ROLE_KEY` 只在服务端使用，不要暴露给前端或提交到 Git。

## Supabase 初始化和迁移

新数据库必须先应用 `supabase/schema.sql`，再按文件名顺序应用 `supabase/migrations/*.sql`。本地工具会在 `.local/` 生成隔离 workdir，并自动完成这个顺序；基础 schema 不会被加入生产 migration 目录，也不会被线上部署误执行。

新增数据库变更使用：

```bash
npm run migration:new -- descriptive_change
npm run supabase:local:reset
```

现有生产项目只应用经过审查的待执行 migration。不要将 `setup:local`、`supabase:local:reset` 或任何 `--linked` reset 用于生产项目。浏览器端不得直接调用 service-role-only RPC，所有写入仍必须走 Server Action 或 Route Handler。

## QQ 账号密码登录（默认）

登录、注册共用一个分步入口：先填写数字 QQ 号。已有密码的账号显示密码输入框；新账号自动向固定的 `QQ号@qq.com` 发送 8 位验证码，填写验证码并设置、确认密码后自动注册和登录。以前只用验证码或 Bot 的账号验证邮箱后设置密码，沿用原账号。忘记密码可在 `/forgot-password` 验证 QQ 邮箱重设密码。

勾选「记住密码」会保持此设备的登录状态（默认 30 天）；未勾选使用浏览器会话 cookie，服务端最多保留 12 小时。密码仅交给 Supabase Auth 校验和保存，不写入浏览器本地存储。原有 QQ Bot 链接登录保留为备用，其他邮箱密码账号仍可从折叠入口登录。

两种 QQ 登录都通过 `resolve_qq_profile` 按 `qq_user_id` 取得同一个 `profiles.id`，使用原有 `app_sessions`，因此投票、提名、真爱票和管理员角色保持不变。Supabase Auth 负责密码及邮件验证码；临时 Auth 会话不进入浏览器。重设密码后撤销原有网站会话。

上线配置与 Bot 群同步说明见 [QQ 邮箱登录与群成员同步](docs/qq-email-login.md)。必须先应用 `20261017143010_qq_password_auth.sql`，并为 Confirm signup、Magic Link、Reset Password 三个邮件模板配置 `{{ .Token }}`。公共邮箱注册继续关闭，服务端仅为数字 QQ 邮箱建立待验证身份。

## QQ Bot 一次性链接登录（备用）

Bot 登录不接 QQ OAuth。Bot 身份由后端带 `BOT_API_SECRET` 调用网站接口传入，网站生成短期一次性 token，数据库只保存 `token_hash`。用户确认链接后，网站按 `qq_user_id` 查找或创建共用的 `profiles` 记录，创建自建 `app_sessions`，并设置 HttpOnly `app_session` cookie。Bot 必须传入真实数字 QQ 号，才能与同号邮箱登录关联；opaque OpenID 不能直接当作 QQ 号映射。

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
