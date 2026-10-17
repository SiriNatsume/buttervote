# QQ 邮箱登录与群成员同步

## 用户流程

登录和注册共用 `/login`，`/register` 自动转入同一入口，并保留 QQ 号及登录后返回地址：

- 首先只显示 QQ 号，点击「下一步」后由服务端识别账号。
- 已完成密码设置：显示密码输入框，校验密码后返回原页面，不发送邮件。
- 未注册：自动向固定的 `QQ号@qq.com` 发验证码，提示已发送，显示 8 位验证码、设置密码和确认密码。验证及密码保存成功后自动注册并登录。
- 已有验证码或 QQ Bot 账号但未设密码：验证邮箱、设置密码，复用原 `profiles.id` 及全部投票记录。
- 忘记密码：进入 `/forgot-password`，保留 QQ 号和原返回地址，发送重设密码验证码，填写验证码和两次新密码后自动登录。旧密码和原有网站会话失效。

新密码至少 8 位且 UTF-8 编码最多 72 字节。已有旧密码仍可登录。「记住密码」默认不勾选：不勾选使用浏览器会话 cookie，服务端有效期最多 12 小时；勾选使用 `APP_SESSION_DAYS`（默认 30 天）的持久 HttpOnly cookie。浏览器密码管理器可以保存密码，网站不会将密码写入 localStorage 或普通 cookie。

收不到邮件时，展开「使用 QQ Bot 登录」，私聊 Potato 发送 `/login`。原有链接确认页、短期 token、一次性消费保持不变。其他邮箱密码账号保留在另一个折叠入口中；数字 QQ 邮箱统一走上方 QQ 入口，避免产生独立身份。

## 部署前配置

1. 通过正常迁移流程应用 `supabase/migrations/20261015054100_qq_email_login_and_group_sync.sql` 及 `supabase/migrations/20261017143010_qq_password_auth.sql`（已应用的迁移无需重复执行）。新增状态查询只返回是否注册、是否验证及是否设置密码，只有 service role 可执行，读取 Auth 的函数位于不暴露的私有 schema。不要重放基础 schema，不要在生产运行本地 reset。
2. 在 Supabase Auth 保持 Email provider 开启，**关闭公开注册（Allow new users to sign up）**，开启邮件确认，密码最短长度设为 8。网站服务端通过 Admin API 仅为数字 QQ 邮箱建立未确认 Auth 身份，首次使用通过 `resend(type: signup)` 发送确认码，已确认但未设密码的账号通过 `signInWithOtp(shouldCreateUser: false)` 验证邮箱。验证码验证后必须成功设置密码才能建立投票会话。已注册账号用 `signInWithPassword`；忘记密码用 `resetPasswordForEmail` 和 `verifyOtp(type: recovery)`，验证后用临时用户会话 `updateUser` 更新密码，不通过 Admin API 跳过邮箱验证。
3. 为生产配置 Custom SMTP，验证发件域名、发信额度和实际 QQ 邮箱送达。Supabase 默认测试发信服务不适合直接用于普通用户生产登录。
4. 将 **Magic Link、Confirm signup、Reset Password 三个邮件模板**都改成验证码邮件，参考 `supabase/local/templates/qq-email.html`。必须保留 `{{ .Token }}`，不能只留下 `{{ .ConfirmationURL }}`。设置 OTP 长度 8、有效期 600 秒，发信间隔建议至少 60 秒。Reset Password 建议使用「Butter Vote 重设密码验证码」主题。模板文本与有效期设置保持一致。
5. 网站继续使用现有 Supabase URL、anon key、service role key、`BOT_API_SECRET` 和 app session 配置。所有私密 key 仅配置在服务端。
6. 用自己控制的真实 QQ 号完成一次邮件收取、登录和 Bot 备用登录，确认同一个账号和投票记录后再对外开放。仓库本地测试只会投递到本机 Mailpit，不能证明生产 SMTP 的送达率。

账号识别、验证码发送、密码登录和验证码校验接口都要求同源 POST。数据库限流覆盖账号识别、密码尝试、验证码尝试、来源 IP 和发信总量；生产仍需保留 Supabase 的 Auth 限流。按 QQ 分流会展示该 QQ 是否已经注册，因此只返回当前步骤，不返回内部用户 ID、昵称或其他账号资料。验证码和 Auth access/refresh token 不记录到日志、不返回前端。投票会话继续使用 HttpOnly、Secure（生产）、SameSite=Lax cookie。

### 阿里云 DirectMail 接入

本项目选择阿里云 DirectMail 华东 1（杭州）区域，使用独立子域名 `auth.buttervote.com`，发信地址为 `login@auth.buttervote.com`，类型选「触发邮件」。需先按阿里云控制台给出的实际值配置子域名的 DKIM、SPF、DMARC、MX 四条 DNS 记录，并在阿里云确认「验证通过」。

Supabase 的 SMTP 参数：

| 字段 | 值 |
| --- | --- |
| Sender email address | `login@auth.buttervote.com` |
| Sender name | `Butter Vote` |
| Host | `smtpdm.aliyun.com` |
| Port number | `465`（SSL） |
| Minimum interval per user | `60` 秒 |
| Username | `login@auth.buttervote.com` |
| Password | 在阿里云为该发信地址自行设置的 SMTP 密码 |

SMTP 密码不是阿里云账号登录密码。仅在阿里云和 Supabase 控制台中设置、保存，不提交到仓库。阿里云控制台提示 SMTP 密码设置后约 2 分钟内生效；新地址的实际送达应另外测试。

2026-10-15 已完成生产配置：四条子域名 DNS 记录已导入，阿里云域名显示「验证通过」、触发类发信地址显示「正常」。用户已在两处保存 SMTP 密码；刷新 Supabase 后确认自定义 SMTP 仍开启、上述非密码参数已保存。OTP 保持 8 位、有效期 600 秒，两个验证码模板已保存。向用户授权的自有 QQ 邮箱发送 1 封测试验证码后，Supabase 请求成功，阿里云记录显示投递成功、QQ 邮件服务器返回 `250 Send Mail OK`，用户确认邮件进入收件箱。网站代码发布和 Bot 主机接入仍需分别完成。

Supabase Auth Rate Limits 页已确认当前项目邮件限额为 30 封/小时；正式活动前应按预计登录峰值检查此限额。阿里云当前赠送总计 2,000 封、每日最多免费 200 封，赠额用完按约 ¥2/千封计费，具体以账号控制台和当前价格页为准。

官方说明：[SMTP 服务地址](https://help.aliyun.com/zh/direct-mail/smtp-endpoints)、[设置发信地址及 SMTP 密码](https://help.aliyun.com/zh/direct-mail/user-guide/setup-sender-addresses)、[计费方式](https://help.aliyun.com/zh/direct-mail/billing-methods)。

## 账号兼容

- QQ Bot 和 QQ 邮箱使用同一 `resolve_qq_profile` RPC，数据库唯一约束和事务锁避免同时注册产生两个投票账号。
- 邮箱校验成功后，服务端只接受 Auth 返回的已确认、精确匹配数字 QQ 邮箱的用户；浏览器传入的邮箱、profile id 或角色不能决定绑定结果。
- 已有 QQ 账号保留原 id、角色、昵称及投票数据。邮箱登录不会用空昵称覆盖 Bot 昵称。
- 密码是否已由用户设置以服务端 `app_metadata.qq_password_set` 为准，用户可编辑的 `user_metadata` 不能作为依据。旧验证码账号即使带有 Auth 自动生成的随机密码，也进入邮箱设密码流程；旧邮箱密码 profile（id 等于 Auth user id）继续允许原密码登录。新密码设置成功或密码校验成功后才写入此标记。
- 数字 QQ 邮箱只使用可撤销的 `app_sessions`；残留的旧 Supabase 浏览器 cookie 不能绕过网站会话校验。其他邮箱账号保留原有登录方式。
- 如果旧系统曾给同一个人建立了独立的「邮箱 profile」和「QQ profile」，邮箱入口会报历史账号冲突，保留两边所有数据，并提示使用原 Bot 登录、联系管理员核对。不会自动挑选或删除冲突投票。
- 原 Bot 必须传入真实数字 QQ 号。官方 Bot 的 opaque OpenID 没有直接到数字邮箱的映射，不能把两个不同命名空间强行合并。

## 后台同步 QQ 群成员

在「后台 → 用户组 → 用户组详情」的「从 QQ 群同步成员」中填写群号，点击同步。一个用户组固定绑定一个 QQ 群，一个 QQ 群只能绑定一个用户组；若要使用另一个 QQ 群，请创建新用户组，防止把旧权限转给新群。

后台提交任务后，Bot 端桥接程序取走任务，从 OneBot 获取完整名单，再回传网站。网站无需访问 Bot 的内网 HTTP 端口，也不要求将 OneBot 暴露到公网。后台自动显示等待、运行、成功或失败状态，群成员名单按每页 50 人展示，仅管理员可见。

### 现有 Potato / NoneBot Bot：使用插件

推荐将 [`nonebot_plugin_buttervote`](../integrations/nonebot/nonebot_plugin_buttervote/README.md)
加入现有 Bot 的插件加载列表。插件直接复用 NoneBot 已连接的 OneBot v11 Bot，随 Bot
启动和停止，不需要额外进程、Node.js 或新增 OneBot HTTP 端口。仅需在 Bot 应用的
配置中设置 `BUTTERVOTE_URL`、与网站一致的 `BOT_API_SECRET` 及
`BUTTERVOTE_SYNC_ALLOWED_GROUPS` 群号白名单；设为 `all` 时允许同步 Bot 能读取的任意群聊。
加载、可选配置和切换步骤见插件说明。
启用插件后，停止原有独立同步脚本的常驻任务。

### 其他 Bot 环境：使用独立脚本

将 `scripts/qq-group-sync.mjs` 放在能够访问现有 OneBot HTTP 服务的机器上。它仅依赖 Node.js 20+ 内置模块，不需要修改现有 Bot 插件。将下面的变量保存到不提交的私密环境文件中：

```sh
node --env-file=/absolute/path/buttervote-bot.env scripts/qq-group-sync.mjs --watch
```

所需变量：

| 变量 | 含义 |
| --- | --- |
| `BUTTERVOTE_URL` | 网站 HTTPS 地址；本地测试可用回环 HTTP |
| `BOT_API_SECRET` | 与网站一致的 Bot 服务端密钥 |
| `ONEBOT_HTTP_URL` | OneBot HTTP API 地址，通常为本机回环地址 |
| `ONEBOT_ACCESS_TOKEN` | OneBot HTTP 访问 token |
| `BUTTERVOTE_SYNC_ALLOWED_GROUPS` | 允许同步的 QQ 群号，逗号分隔，必填 |

程序每 5 秒检查一个任务，也可去掉 `--watch` 单次运行。上线时用已有进程管理器托管即可。它检查 OneBot 的 `status/retcode`、名单前后人数、群号、QQ 号和重复条目；空名单、不完整名单或接口失败只会将任务标记失败，不会清空网站原名单。请使用能返回真实数字 QQ 号和完整群成员列表的 OneBot 实现；不能用官方 Bot 的 OpenID 列表代替。

接口（均为服务端 Bearer `BOT_API_SECRET`）：

- `POST /api/bot/group-sync/claim`：领取一个任务，返回任务 id、群号和本次租约 id；任务租约 5 分钟，超时可重新领取。
- `POST /api/bot/group-sync/{id}`：以 `leaseId` 和完整 `members` 数组回传，或以 `error` 错误枚举回传失败。错租约、旧租约及已完成任务不接受覆盖。

只在完整名单成功提交的数据库事务里替换名单、更新成员资格和标记任务成功。服务端同步保留未注册成员；之后用户通过 QQ 邮箱或 Bot 登录时，自动匹配名单。

## 群资格的有效期

通过匹配名单并验证 QQ 身份的账号获得长期有效的用户组资格，不受名单同步时间或
`USER_GROUP_MEMBERSHIP_DAYS` 限制。数据库以 PostgreSQL `infinity` 表示长期有效，
后台和「我的用户组」均显示「长期有效」。原有尚未手动撤销的名单资格会随迁移升级。

同步采用补充方式，保留以前的匹配条目；后续群名单中缺少某人不会自动移除匹配关系或
撤销资格。管理员可在用户组详情中逐条移除、勾选多个条目后移除，或移除整个用户组的
全部匹配名单（包含其他分页）。移除操作同时撤销该名单授予的资格，保留账号及历史投票。
未注册 QQ 号也能移除，其后注册或重新同步不会自动恢复被移除的匹配。

匹配名单每页显示 50 人。页码会根据实际总数调整，空名单和移除后的旧分页地址仍可正常
读取；名单在两次请求间缩减时会回到有效页。同步期间每 5 秒刷新，切回页面时立即检查，
也可点击「刷新名单」。用户组统计、成员及资料读取支持分批获取，避免接口单次条数上限
或过长的资料查询地址导致漏项；读取失败不会被伪装成空名单。
名单页面使用动态读取，Bot 领取和回传任务后主动失效相关页面缓存，避免数据库已更新
而后台仍展示旧名单或旧同步状态。
面板通过仅管理员可用、禁止缓存的读取接口更新当前页，避免依赖整页刷新。读取请求
有 20 秒超时，失败时保留原显示并提供重试；身份失效时提示重新登录。

移除记录仅服务端可读写。数据库在同一事务中移除匹配、撤销资格、更新人数，并取消该
用户组尚未完成的同步任务，防止旧任务把名单加回。管理员单独手动授予或撤销的资格仍优先。
`USER_GROUP_MEMBERSHIP_DAYS` 继续用于原有 Bot 现场验证产生的临时资格，默认 7 天，支持 1–90 天。

## 本地验证

```sh
npm run setup:local
npm run dev:local
# 另一个终端
npm run test:qq-auth:local
npm test
npm run typecheck
npm run build:local
```

端到端脚本只接受回环地址，使用真实的本地 Supabase Auth、Postgres、邮件投递和网站 API；OneBot 采用本机模拟服务。覆盖新 QQ 自动发码、验证码与密码共同注册、旧验证码账号设密码、旧密码账号兼容、密码登录与持久/临时会话、邮箱重设密码与旧会话撤销、QQ 残留 Auth cookie 拒绝及其他邮箱管理员兼容，以及 Bot/邮箱身份一致性、投票保留、重复投票拒绝、验证码重放、跨站请求、权限、完整/失败同步、退群、手动撤销和任务租约。

2026-10-17 密码流程完成本地验证：105 项测试、类型检查、Next.js 生产构建、15 组编译后网站端到端检查通过；102 个公开 JavaScript bundle 未检出本地 service-role key。Codex 浏览器核对了初始 QQ 单字段、自动发码注册、已注册密码登录、错误密码提示、忘记密码跳转，以及桌面和 375px 手机布局。新增迁移及 Reset Password 验证码模板只在本地验证，本次没有修改生产配置或部署网站。

2026-10-15 已在 Node.js 24.13.1 下完成：从基础 schema 和全部 migrations 初始化本地数据库、53 项测试、类型检查、Next.js 生产构建，以及编译后网站的 10 组端到端检查。另以浏览器验证了发送验证码、输入验证码后返回原页面、原管理员密码登录和后台同步按钮；后台按钮提交的任务已由本机 OneBot 模拟服务完成。

本地 Supabase security advisors 未报告新增 QQ 表或函数的问题；现有的三个 search_path 警告属于其他历史函数。生产 SMTP 的单封真实 QQ 邮箱送达已另行验证并由用户确认进入收件箱；尚未验证真实 Bot 连接或生产网站的完整双入口登录流程。

相关官方资料：[Supabase 邮箱 OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless)、[SMTP 配置](https://supabase.com/docs/guides/auth/auth-smtp)、[OneBot 群成员接口](https://github.com/botuniverse/onebot-11/blob/master/api/public.md#get_group_member_list-获取群成员列表)、[QQ 数字邮箱地址](https://service.mail.qq.com/detail/0/434)。
