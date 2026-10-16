# QQ 邮箱登录与群成员同步

## 用户流程

默认入口：填写 QQ 号 → 向固定的 `QQ号@qq.com` 发验证码 → 输入验证码 → 返回原投票页面。首次使用自动创建网站账号；已有 QQ Bot 账号复用原 `profiles.id`。没有密码设置或公开的群成员认领列表。

收不到邮件时，展开「使用 QQ Bot 登录」，私聊 Potato 发送 `/login`。原有链接确认页、短期 token、一次性消费保持不变。已有邮箱密码账号保留在另一个折叠入口中。

## 部署前配置

1. 通过正常迁移流程应用 `supabase/migrations/20261015054100_qq_email_login_and_group_sync.sql`。不要重放基础 schema，不要在生产运行本地 reset。
2. 在 Supabase Auth 保持 Email provider 开启，**关闭公开注册（Allow new users to sign up）**，开启邮件确认。网站服务端通过 Admin API 仅为数字 QQ 邮箱建立未确认 Auth 身份，首次使用通过 `resend(type: signup)` 发送确认码，已确认账号通过 `signInWithOtp(shouldCreateUser: false)` 发送登录码。两者都必须输入收到的验证码后才建立投票会话；不会提前确认邮箱所有权。
3. 为生产配置 Custom SMTP，验证发件域名、发信额度和实际 QQ 邮箱送达。Supabase 默认测试发信服务不适合直接用于普通用户生产登录。
4. 将 **Magic Link 和 Confirm signup 两个邮件模板**都改成验证码邮件，参考 `supabase/local/templates/qq-email.html`。必须保留 `{{ .Token }}`，不能只留下 `{{ .ConfirmationURL }}`。设置 OTP 长度 8、有效期 600 秒，发信间隔建议至少 60 秒。模板文本与有效期设置保持一致。
5. 网站继续使用现有 Supabase URL、anon key、service role key、`BOT_API_SECRET` 和 app session 配置。所有私密 key 仅配置在服务端。
6. 用自己控制的真实 QQ 号完成一次邮件收取、登录和 Bot 备用登录，确认同一个账号和投票记录后再对外开放。仓库本地测试只会投递到本机 Mailpit，不能证明生产 SMTP 的送达率。

验证码发送和校验接口要求同源 POST。额外的数据库限流覆盖 QQ 号、来源 IP 和发信总量；生产仍需保留 Supabase 的 Auth 限流。验证码和 Auth access/refresh token 不记录到日志、不返回前端。投票会话继续使用 HttpOnly、Secure（生产）、SameSite=Lax cookie。

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
- 如果旧系统曾给同一个人建立了独立的「邮箱 profile」和「QQ profile」，邮箱入口会报历史账号冲突，保留两边所有数据，并提示使用原 Bot 登录、联系管理员核对。不会自动挑选或删除冲突投票。
- 原 Bot 必须传入真实数字 QQ 号。官方 Bot 的 opaque OpenID 没有直接到数字邮箱的映射，不能把两个不同命名空间强行合并。

## 后台同步 QQ 群成员

在「后台 → 用户组 → 用户组详情」的「从 QQ 群同步成员」中填写群号，点击同步。一个用户组固定绑定一个 QQ 群，一个 QQ 群只能绑定一个用户组；若要使用另一个 QQ 群，请创建新用户组，防止把旧权限转给新群。

后台提交任务后，Bot 端桥接程序取走任务，从 OneBot 获取完整名单，再回传网站。网站无需访问 Bot 的内网 HTTP 端口，也不要求将 OneBot 暴露到公网。后台自动显示等待、运行、成功或失败状态，群成员名单按每页 50 人展示，仅管理员可见。

将 `scripts/qq-group-sync.mjs` 放在能够访问现有 OneBot HTTP 服务的机器上。它仅依赖 Node.js 20+ 内置模块，不需要修改现有 Bot 插件。参考 `docs/bot-group-sync.env.example`，将真实配置保存到不提交的私密环境文件中：

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

`USER_GROUP_MEMBERSHIP_DAYS` 默认 7 天，新同步和登录对接限制为 1–90 天。名单资格从最近完整快照时间计算；重复登录不会延长旧快照的有效期。管理员应在有效期内重新同步，重要投票开始前也应更新名单。

新名单缺少的成员会失去名单授予的资格；比快照更新的 Bot 现场验证不会被旧快照撤销。管理员手动续期或撤销的决定优先，后台同步和备用 Bot 登录均不会自动覆盖。已经提交的投票不因退群而删除。

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

端到端脚本只接受回环地址，使用真实的本地 Supabase Auth、Postgres、邮件投递和网站 API；OneBot 采用本机模拟服务。覆盖 Bot/邮箱两种顺序的账号一致性、原投票保留及重复投票拒绝、验证码重放、注册策略、权限、完整/失败同步、未注册成员认领、退群、手动撤销和任务租约。

2026-10-15 已在 Node.js 24.13.1 下完成：从基础 schema 和全部 migrations 初始化本地数据库、53 项测试、类型检查、Next.js 生产构建，以及编译后网站的 10 组端到端检查。另以浏览器验证了发送验证码、输入验证码后返回原页面、原管理员密码登录和后台同步按钮；后台按钮提交的任务已由本机 OneBot 模拟服务完成。

本地 Supabase security advisors 未报告新增 QQ 表或函数的问题；现有的三个 search_path 警告属于其他历史函数。生产 SMTP 的单封真实 QQ 邮箱送达已另行验证并由用户确认进入收件箱；尚未验证真实 Bot 连接或生产网站的完整双入口登录流程。

相关官方资料：[Supabase 邮箱 OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless)、[SMTP 配置](https://supabase.com/docs/guides/auth/auth-smtp)、[OneBot 群成员接口](https://github.com/botuniverse/onebot-11/blob/master/api/public.md#get_group_member_list-获取群成员列表)、[QQ 数字邮箱地址](https://service.mail.qq.com/detail/0/434)。
