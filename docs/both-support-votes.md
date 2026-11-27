# 同时支持票

单选活动有且仅有两个有效候选项时，默认允许「同时支持两项」。管理员可在活动运营设置中关闭，也可在活动组的批量投票设置中修改所选活动。批量设置修改各活动的开关，不向未来新增活动继承。

## 存储与计分

- `contests.both_support_enabled` 为非空布尔值，默认 `true`，同时适用于已有和新增活动。
- 选票仍存入 `votes`，保留每人每场一条记录的唯一约束。
- 同时支持票的 `payload` 为 `{ "ballotType": "both_support", "candidateIds": ["候选A的UUID", "候选B的UUID"] }`。两个 ID 不同，且必须与提交时全部有效候选项一致。
- 普通选票沿用原来的格式；活动 `vote_type` 仍为 `single`。
- 双方各获得 1 分基础得分，参与人数增加 1；`created_at` 正常记录提交时间，但不参与候选的 `last_vote_at` 计算。
- 同时支持票不产生真爱分配、不消耗真爱额度，也不能补投真爱票。普通选票的加权及补投逻辑保持原样。
- 关闭开关不改变已投出的选票。计票按保存的候选 ID 读取，不随当前候选列表变化自动转移支持对象。

## 写入与交互

服务端和数据库均校验活动状态、开关、候选集合及真爱限制。数据库私有触发器也覆盖直接写入选票或真爱分配的路径；投票 RPC 继续仅供服务端调用。组内混合提交仍在同一事务中完成，任一场无效时全部回滚。

选择入口会点亮两张候选卡，并弹出已确认的说明。确认前不提交选票；「我已知悉」保留同时支持选择，「我再想想」、关闭弹窗或按 Escape 都取消选择。切换时清除尚未提交的真爱票勾选。补投面板不列出同时支持票。

## 迁移与验证

发布前先应用 `supabase/migrations/20261127080552_both_support_votes.sql`，再发布应用代码；应用查询依赖新增字段。

单元测试：

```sh
node --import tsx --test tests/both-support.test.ts
```

数据库集成测试在本地 Supabase 应用迁移后运行，测试数据和测试账号自动回滚：

```sh
docker exec -i supabase_db_butter-vote-local psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/both_support.sql
```

全量测试在 Node 22 或更新版本直接运行 `npm test`。使用 Node 20 时，当前 Supabase SDK 的测试需要 `NODE_OPTIONS=--experimental-websocket npm test`。

公开结果继续遵守统一可见性规则：投票期间隐藏真爱加权，发布后公开加权；同时支持在两种情况下均为双方各 1 分。
