# Butter Vote 群成员同步插件

适用于现有 Potato / NoneBot 2 + OneBot v11 Bot。插件复用已连接的 Bot，
每 5 秒领取网站后台提交的同步任务，通过 Bot 获取完整群名单后回传。
随 Bot 启动和停止，不需要单独运行 Node.js 脚本，也无需新增 OneBot HTTP
端口或配置 `ONEBOT_HTTP_URL` / `ONEBOT_ACCESS_TOKEN`。现有 Bot 登录插件可继续使用。

## 加载

把整个 `nonebot_plugin_buttervote` 文件夹放在与现有插件相同的可导入目录，
在 Bot 应用的现有插件加载列表中增加：

```python
nonebot.load_plugin("nonebot_plugin_buttervote")
```

如果现有应用使用 `nonebot.load_plugins("插件目录")` 自动加载该目录下的所有插件，
放入后即可沿用该机制。使用 `[tool.nonebot]` 时，将 `nonebot_plugin_buttervote`
追加到原有 `plugins` 数组，保留其他插件。不要同时使用多种加载方式。

依赖为 `nonebot2>=2.3,<3`、`nonebot-adapter-onebot>=2.4,<3`、
`httpx>=0.27,<1`、`pydantic>=1.10,<3`，现有 Potato `pyproject.toml` 已包含。
Python 要求 3.10 或以上。

## 配置

将本目录 `.env.example` 的必要配置加入 **Bot 应用现有的** `.env` / `.env.prod`：

```dotenv
BUTTERVOTE_URL=https://your-site.example
BOT_API_SECRET=与网站一致的Bot密钥
BUTTERVOTE_SYNC_ALLOWED_GROUPS=[123456789,987654321]
```

要允许同步 Bot 能读取成员名单的任意群聊，设置：

```dotenv
BUTTERVOTE_SYNC_ALLOWED_GROUPS=all
```

`all` 不要求提前列出群号，支持大小写和前后空白；Bot 仍须能够访问目标群的完整成员名单。
群号白名单也兼容旧脚本的逗号分隔字符串。密钥只保存在 Bot 和网站服务端，
不需要向 Bot 提供 Supabase service-role key。

可选配置：

| 变量 | 默认值 | 含义 |
| --- | --- | --- |
| `BUTTERVOTE_SYNC_ENABLED` | `true` | 是否启动同步 |
| `BUTTERVOTE_SYNC_BOT_ID` | 空 | 使用的 Bot 数字 QQ 号；连接多个 OneBot 时必填 |
| `BUTTERVOTE_SYNC_POLL_SECONDS` | `5` | 轮询间隔，1–300 秒 |
| `BUTTERVOTE_SYNC_TIMEOUT_SECONDS` | `20` | 每次网站或 Bot 请求的超时，1–30 秒 |

缺少必要配置时，仅停用本插件并记录配置提示，不阻止其他 Bot 插件启动。
Bot 离线或连接多个账号但未指定账号时，不领取新任务；恢复连接后继续处理。

## 使用与切换

1. 加载插件、填写配置，重启现有 Bot。
2. 确认 Bot 已加入目标群，并能返回真实数字 QQ 号和完整群成员列表。
3. 在 Butter Vote「后台 → 用户组 → 用户组详情」填写群号，点击「同步群成员」。
4. 后台自动更新状态；成功后显示群成员。无需在 QQ 群里发送指令。

如果之前已经运行独立的 `qq-group-sync.mjs --watch`，启用插件时停止旧脚本的常驻任务，
以后只维护 Bot 进程。切换时未完成的任务由网站租约机制保护，最迟在旧租约到期后重新领取。
目前的任务队列使用一个工作节点的群白名单；应将所有需要同步的群放在同一个工作节点的
白名单中（或设置为 `all`），不要用多个白名单互不相交的插件实例共同消费同一网站队列。

## 名单与失败处理

- 读取顺序为 `get_group_info` → `get_group_member_list` → `get_group_info`，均请求刷新缓存。
- 检查前后群人数一致、名单条数一致、群号正确、QQ 号真实有效且不重复；最多 10,000 人。
- 空名单、缺失成员、人数变化或 Bot 接口失败会回传失败状态，网站保留上一次完整名单。
- 回传暂时失败时先重试同一个任务和租约，防止重复读取和领取；网站拒绝过期租约时丢弃旧结果。
- 成员资格、未注册成员匹配、手动撤销及历史投票均沿用网站现有规则。
- 日志只记录状态、错误类别和成员数量，不记录密钥或名单内容，也不向群或私聊发送消息。

接口保持现有协议：`POST /api/bot/group-sync/claim` 和
`POST /api/bot/group-sync/{id}`，使用 `Authorization: Bearer BOT_API_SECRET`。
关闭 Bot 会取消后台任务并释放 HTTP 连接；被中断的任务可在 5 分钟租约到期后重新领取。

## 验证

在本仓库 `integrations/nonebot` 目录运行：

```sh
python -m unittest discover -s tests -v
```

本地测试覆盖完整同步、错误名单、白名单、离线恢复、多 Bot 选择、回传重试和
NoneBot 真实插件加载及生命周期。测试使用模拟 Bot 和本机测试网站，不连接真实 QQ 群或生产网站。

实现依据：[NoneBot 生命周期](https://nonebot.dev/docs/api/drivers)、
[Bot API 调用](https://nonebot.dev/docs/api/adapters)、
[OneBot v11 群成员接口](https://github.com/botuniverse/onebot-11/blob/master/api/public.md)。
