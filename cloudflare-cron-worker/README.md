# Butter Vote Cron Worker

这个 Worker 每分钟请求一次主站的定时任务接口：

```text
https://buttervote.com/api/cron/apply-scheduled-transitions
```

`CRON_SECRET` 不写入代码，请用 Wrangler Secret 配置。

## 创建和部署

```bash
cd cloudflare-cron-worker
npm install
npm run secret:put
npm run deploy
```

`npm run secret:put` 会要求输入 `CRON_SECRET`。这个值需要和主站 Cloudflare Worker / 环境变量中的 `CRON_SECRET` 完全一致。

## 本地测试

```bash
npm run dev
```

另开一个终端：

```bash
curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"
```

## 频率

当前配置：

```text
* * * * *
```

表示每分钟执行一次。Cloudflare Cron 使用 UTC 时间。
