"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GitFork, LayoutGrid, Trophy } from "lucide-react";
import { useActiveSection } from "@/components/page-section-provider";
import type { SiteNavigationData } from "@/lib/page-navigation";

export function SiteNavigation({
  mobile = false,
  navigation,
}: {
  mobile?: boolean;
  navigation: SiteNavigationData;
}) {
  const pathname = usePathname();
  const activeSection = useActiveSection(navigation);
  const items = [
    { section: "home", label: "活动首页", href: "/", icon: LayoutGrid },
    { section: "results", label: "赛程结果", href: navigation.resultsHref, icon: GitFork },
    { section: "hall-of-fame", label: "冠军殿堂", href: "/hall-of-fame", icon: Trophy },
  ] as const;

  return (
    <nav
      aria-label={mobile ? "底部导航" : "主导航"}
      className={mobile
        ? "fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t border-[#E9E1D2] bg-[#FFFDF7]/95 px-6 backdrop-blur-[10px] lg:hidden"
        : "hidden h-full items-stretch gap-8 lg:flex"}
      style={mobile ? {
        height: "calc(var(--site-bottom-nav-height) + env(safe-area-inset-bottom, 0px))",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      } : undefined}
    >
      {items.map((item) => {
        const active = item.section === activeSection;
        const Icon = item.icon;
        const className = mobile
          ? `flex min-h-11 min-w-0 flex-col items-center justify-center gap-1 text-[10px] transition-colors ${active ? "font-semibold text-[#AE4621]" : "text-[#88786B]"}`
          : `relative flex items-center gap-[7px] text-sm transition-colors hover:text-[#49372C] ${active ? "font-semibold text-[#49372C] after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:rounded-full after:bg-[#D96332]" : "text-[#867466]"}`;
        const content = <>
          <Icon className={mobile ? "size-[19px]" : "size-[17px]"} strokeWidth={1.7} aria-hidden="true" />
          <span>{item.label}</span>
        </>;

        return item.href === null ? (
          <button
            key={item.label}
            type="button"
            disabled
            title="暂未配置默认入口"
            aria-current={active ? "true" : undefined}
            className={`${className} cursor-default opacity-50`}
          >
            {content}
          </button>
        ) : (
          <Link key={item.section} href={item.href} aria-current={active ? (pathname === item.href ? "page" : "true") : undefined} className={className}>
            {content}
          </Link>
        );
      })}
    </nav>
  );
}
