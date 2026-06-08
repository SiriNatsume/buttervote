import Link from "next/link";
import Image from "next/image";
import { LogIn, LogOut, Settings, UserRound, UsersRound } from "lucide-react";
import { logoutAction } from "@/lib/actions/auth-actions";
import { getCurrentProfile } from "@/lib/auth";
import { createServerDataClient } from "@/lib/supabase/server-data";
import { FormSubmitButton } from "@/components/form-submit-button";
import { MobileSiteMenu } from "@/components/mobile-site-menu";
import { Button } from "@/components/ui/button";
import logo from "@/img/网站logo.png";

export async function SiteHeader() {
  const profile = await getCurrentProfile();
  const displayName =
    profile?.qq_nickname ||
    profile?.display_name ||
    profile?.email ||
    "已登录用户";
  const avatarUrl =
    typeof profile?.qq_avatar_url === "string" ? profile.qq_avatar_url : null;
  let hasRejectedNominations = false;

  if (profile) {
    const dataClient = await createServerDataClient();
    const { count } = await dataClient
      .from("nominations")
      .select("id", { count: "exact", head: true })
      .eq("submitter_id", profile.id)
      .eq("status", "rejected");
    hasRejectedNominations = (count ?? 0) > 0;
  }

  return (
    <header className="sticky top-0 z-40 border-b border-[#EED8AA]/70 bg-[#FFFCF4]/80 backdrop-blur">
      <div className="mx-auto flex min-h-16 max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link
          href="/"
          className="flex items-center rounded-full px-1 transition-colors hover:bg-[#FFF3D0]"
          aria-label="Butter Vote 首页"
        >
          <Image
            src={logo}
            alt="Butter Vote logo"
            className="h-12 w-auto rounded-2xl object-contain"
            priority
          />
        </Link>

        <nav className="hidden items-center justify-end gap-2 md:flex">
          <Button asChild variant="ghost" size="sm">
            <Link href="/">首页</Link>
          </Button>
          {profile ? (
            <Button asChild variant="ghost" size="sm">
              <Link href="/me/nominations" className="relative">
                <UserRound className="size-4" />
                我的提名
                {hasRejectedNominations ? (
                  <span className="absolute right-1 top-1 size-2 rounded-full bg-red-500" />
                ) : null}
              </Link>
            </Button>
          ) : null}
          {profile ? (
            <Button asChild variant="ghost" size="sm">
              <Link href="/me/groups">
                <UsersRound className="size-4" />
                我的用户组
              </Link>
            </Button>
          ) : null}
          {profile?.role === "admin" ? (
            <Button asChild variant="ghost" size="sm">
              <Link href="/admin">
                <Settings className="size-4" />
                管理
              </Link>
            </Button>
          ) : null}
          {profile ? (
            <div className="flex items-center gap-2">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt="头像"
                  className="size-8 rounded-full border border-[#EED8AA] object-cover"
                />
              ) : null}
              <span className="hidden max-w-[220px] truncate text-sm text-muted-foreground sm:inline">
                {displayName}
              </span>
              <form action={logoutAction}>
                <FormSubmitButton
                  variant="outline"
                  size="sm"
                  loadingText="退出中..."
                >
                  <LogOut className="size-4" />
                  退出登录
                </FormSubmitButton>
              </form>
            </div>
          ) : (
            <Button asChild size="sm">
              <Link href="/login">
                <LogIn className="size-4" />
                登录
              </Link>
            </Button>
          )}
        </nav>

        <MobileSiteMenu
          profile={
            profile
              ? {
                  role: profile.role,
                  displayName,
                  avatarUrl,
                  hasRejectedNominations,
                }
              : null
          }
        />
      </div>
    </header>
  );
}
