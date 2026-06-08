import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  createAppSession,
  getAppSessionCookieName,
  getAppSessionMaxAgeSeconds,
} from "@/lib/auth/app-session";
import { getUserGroupMembershipExpiresAt } from "@/lib/permissions/user-groups";
import { safeReturnTo, sha256 } from "@/lib/security/token";
import { createRequiredServiceClient } from "@/lib/supabase/service";
import type { Profile, QQLoginTicket } from "@/lib/types";

export const runtime = "nodejs";

type TicketLookupResult =
  | { ok: true; ticket: QQLoginTicket }
  | {
      ok: false;
      error: "qq_ticket_invalid" | "qq_ticket_used" | "qq_ticket_expired";
    };

function redirectToLogin(request: NextRequest, error: string) {
  return NextResponse.redirect(new URL(`/login?error=${error}`, request.url));
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function noStoreHeaders(contentType = "text/html; charset=utf-8") {
  return {
    "Cache-Control": "no-store",
    "Content-Type": contentType,
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
  };
}

function renderConfirmPage(token: string, ticket: QQLoginTicket) {
  const nickname = ticket.qq_nickname?.trim() || "QQ 用户";
  const avatar = ticket.qq_avatar_url?.trim();
  const avatarHtml = avatar
    ? `<img src="${escapeHtml(avatar)}" alt="QQ 头像" class="avatar" />`
    : `<div class="avatar placeholder">Q</div>`;

  return new NextResponse(
    `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>QQ 登录确认</title>
    <style>
      :root { color-scheme: light; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #f7f7f8;
        color: #171717;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        width: min(92vw, 420px);
        border: 1px solid #e5e7eb;
        border-radius: 16px;
        background: white;
        padding: 28px;
        box-shadow: 0 18px 50px rgba(15, 23, 42, 0.08);
        text-align: center;
      }
      .avatar {
        width: 64px;
        height: 64px;
        border-radius: 999px;
        object-fit: cover;
        margin: 0 auto 16px;
      }
      .placeholder {
        display: grid;
        place-items: center;
        background: #111827;
        color: white;
        font-weight: 700;
      }
      h1 { margin: 0; font-size: 22px; }
      p { margin: 12px 0 0; color: #52525b; line-height: 1.7; }
      button {
        margin-top: 22px;
        width: 100%;
        border: 0;
        border-radius: 10px;
        background: #111827;
        color: white;
        padding: 12px 16px;
        font: inherit;
        font-weight: 600;
        cursor: pointer;
      }
      a {
        display: inline-block;
        margin-top: 14px;
        color: #52525b;
        text-decoration: none;
        font-size: 14px;
      }
    </style>
  </head>
  <body>
    <main>
      ${avatarHtml}
      <h1>确认使用 QQ 登录</h1>
      <p>将以「${escapeHtml(nickname)}」进入投票网站。登录链接只会在你点击下方按钮时使用一次。</p>
      <form method="post" action="/auth/qq-ticket">
        <input type="hidden" name="token" value="${escapeHtml(token)}" />
        <button type="submit">继续登录</button>
      </form>
      <a href="/login">返回登录页</a>
    </main>
  </body>
</html>`,
    { headers: noStoreHeaders() },
  );
}

async function getTicketByToken(token: string): Promise<TicketLookupResult> {
  const supabase = createRequiredServiceClient();
  const { data: ticket } = await supabase
    .from("qq_login_tickets")
    .select(
      "id,token_hash,qq_user_id,qq_nickname,qq_avatar_url,return_to,user_group_join_codes,expires_at,used_at,created_at",
    )
    .eq("token_hash", sha256(token))
    .maybeSingle();

  if (!ticket) {
    return { ok: false, error: "qq_ticket_invalid" as const };
  }

  if (ticket.used_at) {
    return { ok: false, error: "qq_ticket_used" as const };
  }

  if (new Date(ticket.expires_at).getTime() <= Date.now()) {
    return { ok: false, error: "qq_ticket_expired" as const };
  }

  return { ok: true, ticket };
}

async function findOrCreateQQProfile(ticket: QQLoginTicket): Promise<Profile> {
  const supabase = createRequiredServiceClient();
  const qqNickname = ticket.qq_nickname?.trim() || null;
  const qqAvatarUrl = ticket.qq_avatar_url?.trim() || null;

  const { data: existingProfile } = await supabase
    .from("profiles")
    .select(
      "id,email,display_name,role,qq_user_id,qq_nickname,qq_avatar_url,login_provider,created_at",
    )
    .eq("qq_user_id", ticket.qq_user_id)
    .maybeSingle();

  if (existingProfile) {
    const { data: updatedProfile, error } = await supabase
      .from("profiles")
      .update({
        qq_nickname: qqNickname,
        qq_avatar_url: qqAvatarUrl,
      })
      .eq("id", existingProfile.id)
      .select(
        "id,email,display_name,role,qq_user_id,qq_nickname,qq_avatar_url,login_provider,created_at",
      )
      .single();

    if (error || !updatedProfile) {
      throw new Error(error?.message ?? "更新 QQ 用户资料失败。");
    }

    return updatedProfile;
  }

  const displayName = qqNickname ?? `QQ 用户 ${ticket.qq_user_id.slice(-4)}`;
  const { data: createdProfile, error } = await supabase
    .from("profiles")
    .insert({
      id: randomUUID(),
      email: null,
      display_name: displayName,
      role: "user",
      qq_user_id: ticket.qq_user_id,
      qq_nickname: qqNickname,
      qq_avatar_url: qqAvatarUrl,
      login_provider: "qq_bot",
    })
    .select(
      "id,email,display_name,role,qq_user_id,qq_nickname,qq_avatar_url,login_provider,created_at",
    )
    .single();

  if (!error && createdProfile) {
    return createdProfile;
  }

  const { data: racedProfile, error: racedError } = await supabase
    .from("profiles")
    .select(
      "id,email,display_name,role,qq_user_id,qq_nickname,qq_avatar_url,login_provider,created_at",
    )
    .eq("qq_user_id", ticket.qq_user_id)
    .maybeSingle();

  if (racedError || !racedProfile) {
    throw new Error(error?.message ?? racedError?.message ?? "创建 QQ 用户资料失败。");
  }

  return racedProfile;
}

async function syncTicketUserGroups(profileId: string, ticket: QQLoginTicket) {
  const joinCodes = [
    ...new Set(
      (Array.isArray(ticket.user_group_join_codes)
        ? ticket.user_group_join_codes
        : []
      )
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];

  if (joinCodes.length === 0) {
    return;
  }

  const supabase = createRequiredServiceClient();
  const { data: userGroups, error } = await supabase
    .from("user_groups")
    .select("id,join_code")
    .in("join_code", joinCodes);

  if (error) {
    console.warn("QQ ticket 用户组同步查询失败。", error.message);
    return;
  }

  const foundJoinCodes = new Set(
    (userGroups ?? [])
      .map((userGroup) => userGroup.join_code)
      .filter((value): value is string => Boolean(value)),
  );
  const missingJoinCodes = joinCodes.filter((joinCode) => !foundJoinCodes.has(joinCode));

  if (missingJoinCodes.length > 0) {
    console.warn("QQ ticket 携带了不存在的用户组 join_code。", missingJoinCodes);
  }

  if (!userGroups || userGroups.length === 0) {
    return;
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = getUserGroupMembershipExpiresAt(now).toISOString();
  const { error: upsertError } = await supabase
    .from("user_group_members")
    .upsert(
      userGroups.map((userGroup) => ({
        user_group_id: userGroup.id,
        profile_id: profileId,
        source: "qq_ticket",
        last_verified_at: nowIso,
        expires_at: expiresAt,
        revoked_at: null,
      })),
      { onConflict: "user_group_id,profile_id" },
    );

  if (upsertError) {
    console.warn("QQ ticket 用户组同步失败。", upsertError.message);
  }
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token")?.trim();

  if (!token) {
    return redirectToLogin(request, "qq_ticket_missing");
  }

  const result = await getTicketByToken(token);

  if (!result.ok) {
    return redirectToLogin(request, result.error);
  }

  return renderConfirmPage(token, result.ticket);
}

export async function POST(request: NextRequest) {
  const formData = await request.formData().catch(() => null);
  const token =
    typeof formData?.get("token") === "string"
      ? String(formData.get("token")).trim()
      : request.nextUrl.searchParams.get("token")?.trim();

  if (!token) {
    return redirectToLogin(request, "qq_ticket_missing");
  }

  const supabase = createRequiredServiceClient();
  const tokenHash = sha256(token);
  const now = new Date();
  const nowIso = now.toISOString();

  const { data: claimedTicket } = await supabase
    .from("qq_login_tickets")
    .update({ used_at: nowIso })
    .eq("token_hash", tokenHash)
    .is("used_at", null)
    .gt("expires_at", nowIso)
    .select(
      "id,token_hash,qq_user_id,qq_nickname,qq_avatar_url,return_to,user_group_join_codes,expires_at,used_at,created_at",
    )
    .maybeSingle();

  if (!claimedTicket) {
    return redirectToLogin(request, "qq_ticket_used");
  }

  const profile = await findOrCreateQQProfile(claimedTicket);
  await syncTicketUserGroups(profile.id, claimedTicket);
  const { sessionToken, expiresAt } = await createAppSession(profile.id);
  const response = NextResponse.redirect(
    new URL(safeReturnTo(claimedTicket.return_to), request.url),
  );

  response.cookies.set(getAppSessionCookieName(), sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: getAppSessionMaxAgeSeconds(),
    expires: expiresAt,
  });

  return response;
}
