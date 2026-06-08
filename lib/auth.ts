import "server-only";

import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { getProfileByAppSession } from "@/lib/auth/app-session";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export async function getCurrentUser(): Promise<User | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
}

export async function getCurrentProfile(): Promise<Profile | null> {
  const appSessionProfile = await getProfileByAppSession();

  if (appSessionProfile) {
    return appSessionProfile;
  }

  const user = await getCurrentUser();

  if (!user) {
    return null;
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select(
      "id,email,display_name,role,qq_user_id,qq_nickname,qq_avatar_url,login_provider,created_at",
    )
    .eq("id", user.id)
    .maybeSingle();

  return data;
}

export async function requireUser(): Promise<Profile> {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login");
  }

  return profile;
}

export async function requireAdmin(): Promise<Profile> {
  const profile = await requireUser();

  if (profile.role !== "admin") {
    redirect("/");
  }

  return profile;
}

export async function getActionUser(): Promise<
  | { ok: true; profile: Profile }
  | { ok: false; error: string }
> {
  try {
    const profile = await getCurrentProfile();

    if (!profile) {
      return {
        ok: false,
        error: "登录状态已失效，请重新登录后再试。",
      };
    }

    return { ok: true, profile };
  } catch {
    return {
      ok: false,
      error: "网络连接不稳定，请稍后再试。",
    };
  }
}

export async function getActionAdmin(): Promise<
  | { ok: true; profile: Profile }
  | { ok: false; error: string }
> {
  const userResult = await getActionUser();

  if (!userResult.ok) {
    return userResult;
  }

  if (userResult.profile.role !== "admin") {
    return {
      ok: false,
      error: "你没有权限执行该操作。",
    };
  }

  return userResult;
}
