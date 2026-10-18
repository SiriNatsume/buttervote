# 部署与密钥说明

本文档用于把 Butter Vote 接入 GitHub 协作和 Cloudflare 自动部署。

## 生产发布流程

1. 在功能分支提交改动并推送到远端仓库。
2. 创建目标为 `main` 的 PR，等待代码审查并处理反馈。
3. 审查完成后合并 PR，由已连接仓库的 Cloudflare Workers Builds 自动部署。

日常更新必须经过上述流程。只有维护者明确要求手动发布时，才使用下文的本地部署命令；不要将“部署更新”理解为跳过 PR 和审查直接执行 Wrangler。数据库迁移需要在 PR 中说明依赖顺序和目标环境的已执行状态，已应用的迁移不要重复执行。

## 不能提交到 GitHub 的内容

- `.env`、`.env.local`、`.env.production`、`.dev.vars`
- `SUPABASE_SERVICE_ROLE_KEY`
- `BOT_API_SECRET`
- `CRON_SECRET`
- `CLOUDFLARE_API_TOKEN`
- `.wrangler/`、`.open-next/`、`.next/`、`node_modules/`
- 任何数据库备份、生产用户数据、导出的投票数据

`.env.example` 只能保存变量名和空值/示例值，不能保存真实密钥。

## 主站 Worker

Cloudflare Workers Builds 连接 GitHub 仓库后，主站建议配置：

- Root directory: 仓库根目录
- Production branch: `main`
- Deploy command: `npm run deploy:raw`

维护者明确要求手动发布时，本地 Windows 可使用：

```powershell
npm run deploy
```

`npm run deploy` 会调用 `scripts/deploy-cloudflare.ps1`，自动清理代理变量并把 Wrangler 日志写入仓库内的 `.wrangler/logs`。Cloudflare 的 Linux 构建环境应使用跨平台的 `deploy:raw`。

## 定时任务 Worker

如果单独连接 `cloudflare-cron-worker`：

- Root directory: `cloudflare-cron-worker`
- Production branch: `main`
- Deploy command: `npm run deploy:raw`

维护者明确要求手动发布时，本地 Windows 可使用：

```powershell
npm run deploy -- -Target cron
```

或者进入 `cloudflare-cron-worker` 后运行：

```powershell
npm run deploy
```

## Cloudflare 变量和 Secrets

非敏感配置可以作为 Worker variables：

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `APP_SESSION_COOKIE_NAME`
- `APP_SESSION_DAYS`
- `QQ_LOGIN_TICKET_TTL_MINUTES`
- `NEXT_PUBLIC_SITE_URL`
- `USER_GROUP_MEMBERSHIP_DAYS`

敏感值必须作为 Worker secrets：

- `SUPABASE_SERVICE_ROLE_KEY`
- `BOT_API_SECRET`
- `CRON_SECRET`

本地部署所需的 Cloudflare 凭据只放在本机环境变量或本机 `.env`：

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

## Supabase

协作者本地开发需要自己的 `.env.local`，从 `.env.example` 复制变量名后填入开发环境值。生产环境的 `SUPABASE_SERVICE_ROLE_KEY` 只能配置在 Cloudflare secret 中，不能进入浏览器 bundle，也不能提交到 GitHub。
