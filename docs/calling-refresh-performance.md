# 报票结果页刷新

单场和活动组结果页共用 `ContestCallingAutoRefresh`。管理员的报票控制、自动推进间隔、阶段暂停与完整结果权限保持原样。

- `draft / active / paused` 会话使用私有 Broadcast 频道 `buttervote:calling:<contest UUID>`，事件名 `calling_changed`。匿名访客使用现有 anon JWT，不需要登录。
- 数据库触发器只发送刷新提示（Supabase 自动补充消息 ID），不发送会话行、报票事件、票数、seed 或 metadata。订阅授权复用会话表现有 RLS；浏览器不能向这个私有命名空间发送消息。
- 收到提示后等待 100ms 合并同一波更新，批量查询所有正在观看的活动；只有状态、进度、版本或会话身份改变才调用 `router.refresh()`。刷新期间到达的提示会排队补查。
- 全部频道订阅成功后，每 15 秒校准一次状态，防止偶发漏消息：空闲周期查询由每分钟约 40 次降至 4 次。订阅未成功、断线或查询失败时，继续原来的 1.5 秒轮询（自定义间隔下限仍为 800ms）。更新通知不需要等待校准间隔。
- 隐藏页面或离线时停止查询并释放频道；回到前台、恢复联网、窗口获得焦点，以及订阅成功后立即校准。查询 10 秒超时，切换活动或卸载会取消旧请求。
- 常规进度更新复用已有频道。活动组中的一场完成后，其他活动继续订阅。频道移除完成后才会重新加入，避免 SDK 复用正在关闭的频道。

迁移还会在会话新增、替换、归档、删除及活动可见性变化时通知；状态与继承关系变化同时通知受影响的下游活动。继承遍历复用现有 `candidates_contest_idx` 和 `candidates_inherited_from_idx`，使用去重递归处理循环关系。结果内容始终由原有 RLS 和服务端结果可见性逻辑决定。

## 发布顺序

先部署增量迁移 `20261022020912_calling_refresh_broadcast.sql`，再合并前端 PR，交给 Cloudflare 自动部署。迁移不修改结果读取策略、表字段或报票操作。旧前端继续原有轮询；新前端在推送不可用时自动回退。

本次生产构建遇到 Next.js 15 的支持期拦截，因此同时升级到受支持的 Next.js 16.4.2 和 OpenNext 1.20.12。继续使用 Webpack 与现有 Edge middleware；公开设置失效显式使用 `revalidateTag(tag, { expire: 0 })` 保持立即更新。React 版本和业务逻辑保持原样，ESLint 改用独立 CLI。

## 验证

使用 Node.js 22+，启动本地 Supabase 并应用迁移后：

```sh
node --import tsx --test tests/contest-calling-refresh.test.ts tests/contest-calling.test.ts
npm run test:calling-refresh:local
npm run test:result-visibility:local
npm run typecheck
```

调度测试覆盖空闲查询次数、断线回退、重复通知、刷新期间的更新、旧请求、隐藏/离线和超时恢复。集成脚本仅允许 loopback Supabase，验证匿名及登录用户、禁止伪造通知、未公开报票事件隔离、组合页面和继承可见性变化、完成/归档/删除，并清理自建数据。
