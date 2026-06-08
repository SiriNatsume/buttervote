import "server-only";

import { cookies } from "next/headers";
import { generateRandomToken, getEnvNumber, sha256 } from "@/lib/security/token";
import { createRequiredServiceClient, createServiceClient } from "@/lib/supabase/service";
import type { Profile } from "@/lib/types";

export function getAppSessionCookieName() {
  return process.env.APP_SESSION_COOKIE_NAME || "app_session";
}

export function getAppSessionMaxAgeSeconds() {
  return getEnvNumber("APP_SESSION_DAYS", 30) * 24 * 60 * 60;
}

export async function getAppSessionTokenFromCookies() {
  const cookieStore = await cookies();
  return cookieStore.get(getAppSessionCookieName())?.value ?? null;
}

export async function getProfileByAppSession(): Promise<Profile | null> {
  const sessionToken = await getAppSessionTokenFromCookies();

  if (!sessionToken) {
    return null;
  }

  const supabase = createServiceClient();

  if (!supabase) {
    return null;
  }

  const { data: session } = await supabase
    .from("app_sessions")
    .select("profile_id")
    .eq("session_token_hash", sha256(sessionToken))
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (!session) {
    return null;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "id,email,display_name,role,qq_user_id,qq_nickname,qq_avatar_url,login_provider,created_at",
    )
    .eq("id", session.profile_id)
    .maybeSingle();

  return profile;
}

export async function createAppSession(profileId: string) {
  const supabase = createRequiredServiceClient();
  const sessionToken = generateRandomToken();
  const expiresAt = new Date(Date.now() + getAppSessionMaxAgeSeconds() * 1000);

  const { error } = await supabase.from("app_sessions").insert({
    profile_id: profileId,
    session_token_hash: sha256(sessionToken),
    expires_at: expiresAt.toISOString(),
  });

  if (error) {
    throw new Error(error.message);
  }

  return { sessionToken, expiresAt };
}

export async function revokeCurrentAppSession() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(getAppSessionCookieName())?.value;

  if (sessionToken) {
    const supabase = createServiceClient();
    if (supabase) {
      await supabase
        .from("app_sessions")
        .update({ revoked_at: new Date().toISOString() })
        .eq("session_token_hash", sha256(sessionToken))
        .is("revoked_at", null);
    }
  }

  cookieStore.set(getAppSessionCookieName(), "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
