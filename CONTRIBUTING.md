# 参与 Butter Vote 开发

感谢参与 Butter Vote。项目的完整业务依赖 Supabase PostgreSQL、Auth、Storage、Realtime 和数据库 RPC，因此本地开发使用真实的本地 Supabase，而不是另一套 mock 数据路径。

## 环境要求

- Node.js 20 或更高版本
- npm
- Docker Desktop 或兼容 Docker API 的容器运行时

## 第一次运行

```bash
npm install
npm run setup:local
npm run dev:local
```

打开 `http://localhost:3000`。Supabase Studio 位于 `http://127.0.0.1:54323`，测试邮件位于 `http://127.0.0.1:54324`。

本地测试账号：

| 角色 | 邮箱 | 密码 |
| --- | --- | --- |
| 管理员 | `admin@buttervote.local` | `ButterVoteAdmin123!` |
| 普通用户 | `user@buttervote.local` | `ButterVoteUser123!` |

这些账号和密码只存在于本机 Docker 环境，不得用于任何托管环境。

## 本地环境如何隔离

- `scripts/local-supabase.mjs` 只操作 `.local/supabase-project`。
- `supabase/schema.sql` 会作为本地第一条基础 migration 被复制，然后按文件名顺序复制 `supabase/migrations/*.sql`。
- Supabase URL 必须是 `localhost`、`127.0.0.1` 或 `::1`，否则脚本立即停止。
- 本地 key 写入 `.local/supabase-app.env`；`.local/` 已被 Git 忽略。
- `dev:local` 和 `build:local` 会把全部应用必需变量注入为本地值，并优先于已有 `.env.local`；它们不会修改该文件。
- 脚本不接受远端数据库 URL，不使用 `--linked`，也不会读取 Cloudflare 生产配置。


## 常用命令

```bash
# 首次安装或彻底重建本地数据
npm run setup:local

# 保留数据，启动或停止本地 Supabase
npm run supabase:local:start
npm run supabase:local:stop

# 丢弃并重建纯本地数据库
npm run supabase:local:reset

# 查看本地服务地址和测试账号
npm run supabase:local:status

# 使用本地 Supabase 启动或构建应用
npm run dev:local
npm run build:local

# 运行完整测试或仅验证本地工具的隔离和迁移组装
npm test
npm run test:local-tools
```

`setup:local` 和 `supabase:local:reset` 会删除当前 `butter-vote-local` 数据卷中的业务数据并重新播种，但不会操作其他 Docker 项目或任何远端数据库。

## 数据库变更

必须通过项目命令调用 Supabase CLI 创建 migration：

```bash
npm run migration:new -- descriptive_change
```

编辑新生成的 `supabase/migrations/<timestamp>_descriptive_change.sql`，然后执行：

```bash
npm run supabase:local:reset
npm run typecheck
npm run build:local
```

不要手写 migration 时间戳，不要使用 `supabase db reset --linked`，也不要为了绕过 RLS 给函数随意添加 `SECURITY DEFINER`。数据库函数、RLS、Storage 或权限发生变化时，应额外检查 Supabase advisors。

## 提交前检查

至少运行：

```bash
npm test
npm run typecheck
npm run build:local
git diff --check
```

只提交与改动有关的文件。不得提交 `.local/`、`.env*`、`.dev.vars*`、数据库密钥、登录 token、cookie 或真实用户数据。
