"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ChevronDown,
  LogIn,
  LogOut,
  Settings,
  UserRound,
  UsersRound,
} from "lucide-react";
import { logoutAction } from "@/lib/actions/auth-actions";
import { FormSubmitButton } from "@/components/form-submit-button";
import { Button } from "@/components/ui/button";

type MobileMenuProfile = {
  role: string;
  displayName: string;
  avatarUrl: string | null;
  hasRejectedNominations: boolean;
} | null;

export function SiteAccountMenu({ profile }: { profile: MobileMenuProfile }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const hasRejectedNominations = Boolean(profile?.hasRejectedNominations);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  function close() {
    setOpen(false);
  }

  if (!profile) {
    return (
      <Button asChild size="sm" className="ml-auto min-h-10">
        <Link href="/login"><LogIn className="size-4" />登录</Link>
      </Button>
    );
  }

  return (
    <details
      name="site-header-navigation"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="relative ml-auto shrink-0"
    >
      <summary className="relative flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-full border border-[#E9E1D2] bg-[#FFFEFA] py-1 pl-1 pr-2.5 text-[#49372C] transition-colors hover:bg-[#FFF3D0] [&::-webkit-details-marker]:hidden">
        {profile.avatarUrl ? (
          <img src={profile.avatarUrl} alt="" className="size-7 shrink-0 rounded-full bg-[#FFF0C0] object-cover lg:size-[30px]" />
        ) : (
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#FFF0C0] lg:size-[30px]">
            <UserRound className="size-4" aria-hidden="true" />
          </span>
        )}
        <span className="max-w-16 truncate text-[11px] sm:max-w-32 sm:text-[13px]">{profile.displayName}</span>
        <ChevronDown className="size-3 shrink-0 lg:size-3.5" aria-hidden="true" />
        {hasRejectedNominations ? (
          <span className="absolute -right-1 -top-1 size-2.5 rounded-full bg-red-500 ring-2 ring-[#FFFCF4]">
            <span className="sr-only">有被拒绝的提名</span>
          </span>
        ) : null}
      </summary>
      <div className="absolute right-0 top-full z-50 mt-3 w-[min(86vw,20rem)] rounded-2xl border border-[#EED8AA]/80 bg-[#FFFCF4] p-3 shadow-xl">
        {profile ? (
          <div className="mb-3 flex items-center gap-3 rounded-xl bg-[#FFF8E8] p-3">
            {profile.avatarUrl ? (
              <img
                src={profile.avatarUrl}
                alt="头像"
                className="size-9 rounded-full border border-[#EED8AA] object-cover"
              />
            ) : null}
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">
                {profile.displayName}
              </div>
              <div className="text-xs text-muted-foreground">
                {profile.role === "admin" ? "管理员" : "已登录"}
              </div>
            </div>
          </div>
        ) : null}

        <div className="grid gap-2">
          {profile ? (
            <Button asChild variant="view" className="justify-start">
              <Link
                href="/me/nominations"
                onClick={close}
                className="relative pr-7"
              >
                <UserRound className="size-4" />
                全部提名
                {profile.hasRejectedNominations ? (
                  <>
                    <span className="absolute right-3 top-1/2 size-2.5 -translate-y-1/2 rounded-full bg-red-500 ring-2 ring-[#FFFCF4]" />
                    <span className="sr-only">有被拒绝的提名</span>
                  </>
                ) : null}
              </Link>
            </Button>
          ) : null}
          {profile ? (
            <Button asChild variant="view" className="justify-start">
              <Link href="/me/groups" onClick={close}>
                <UsersRound className="size-4" />
                我的用户组
              </Link>
            </Button>
          ) : null}
          {profile?.role === "admin" ? (
            <Button asChild variant="ghost" className="justify-start">
              <Link href="/admin" onClick={close}>
                <Settings className="size-4" />
                管理
              </Link>
            </Button>
          ) : null}
          {profile ? (
            <form action={logoutAction} onSubmit={close}>
              <FormSubmitButton
                variant="outline"
                className="w-full justify-start"
                loadingText="退出中..."
              >
                <LogOut className="size-4" />
                退出登录
              </FormSubmitButton>
            </form>
          ) : (
            <Button asChild className="justify-start">
              <Link href="/login" onClick={close}>
                <LogIn className="size-4" />
                登录
              </Link>
            </Button>
          )}
        </div>
      </div>
    </details>
  );
}
