import { NextResponse } from "next/server";
import { applyScheduledTransitions } from "@/lib/scheduled-transitions";
import { timingSafeEqualString } from "@/lib/security/token";

async function handleApply(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  const bearerToken = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;

  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET 未配置" },
      { status: 500 },
    );
  }

  if (!timingSafeEqualString(bearerToken, secret)) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const applied = await applyScheduledTransitions({ revalidate: true });
  return NextResponse.json({ applied });
}

export async function GET(request: Request) {
  return handleApply(request);
}

export async function POST(request: Request) {
  return handleApply(request);
}
