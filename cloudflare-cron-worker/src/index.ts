export interface Env {
  APP_URL: string;
  CRON_SECRET: string;
}

export default {
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(applyScheduledTransitions(env));
  },

  async fetch() {
    return Response.json({
      ok: true,
      service: "buttervote-cron-worker",
    });
  },
};

async function applyScheduledTransitions(env: Env) {
  const endpoint = new URL("/api/cron/apply-scheduled-transitions", env.APP_URL);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.CRON_SECRET}`,
    },
  });
  const body = await response.text();

  if (!response.ok) {
    console.error("定时任务执行失败", response.status, body);
  }

  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}
