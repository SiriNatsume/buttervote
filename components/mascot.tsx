import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type MascotKind =
  | "avatarIcon"
  | "bracketNotReady"
  | "championCelebration"
  | "emptyCandidates"
  | "emptyContests"
  | "errorState"
  | "homepageWelcome"
  | "restrictedAccess"
  | "shareImageFooter"
  | "voteSuccess";

type MascotAsset = {
  src: string;
  width: number;
  height: number;
  alt: string;
};

const MASCOT_ASSETS: Record<MascotKind, MascotAsset> = {
  avatarIcon: {
    src: "/img/girls/avatar-icon.webp",
    width: 360,
    height: 360,
    alt: "Butter Vote 看板娘头像",
  },
  bracketNotReady: {
    src: "/img/girls/bracket-not-ready.webp",
    width: 720,
    height: 540,
    alt: "Butter Vote 看板娘拿着尚未完成的对阵图",
  },
  championCelebration: {
    src: "/img/girls/champion-celebration.webp",
    width: 540,
    height: 720,
    alt: "Butter Vote 看板娘庆祝冠军诞生",
  },
  emptyCandidates: {
    src: "/img/girls/empty-candidates.webp",
    width: 540,
    height: 720,
    alt: "Butter Vote 看板娘等待候选项加入",
  },
  emptyContests: {
    src: "/img/girls/empty-contests.webp",
    width: 540,
    height: 720,
    alt: "Butter Vote 看板娘等待活动发布",
  },
  errorState: {
    src: "/img/girls/error-state.webp",
    width: 540,
    height: 720,
    alt: "Butter Vote 看板娘提示页面出错",
  },
  homepageWelcome: {
    src: "/img/girls/homepage-welcome.webp",
    width: 570,
    height: 760,
    alt: "Butter Vote 看板娘欢迎来访",
  },
  restrictedAccess: {
    src: "/img/girls/restricted-access.webp",
    width: 540,
    height: 720,
    alt: "Butter Vote 看板娘提示需要权限",
  },
  shareImageFooter: {
    src: "/img/girls/share-image-footer.webp",
    width: 520,
    height: 390,
    alt: "Butter Vote 看板娘",
  },
  voteSuccess: {
    src: "/img/girls/vote-success.webp",
    width: 540,
    height: 720,
    alt: "Butter Vote 看板娘庆祝投票成功",
  },
};

export function MascotFigure({
  kind,
  className,
  eager = false,
  decorative = false,
}: {
  kind: MascotKind;
  className?: string;
  eager?: boolean;
  decorative?: boolean;
}) {
  const asset = MASCOT_ASSETS[kind];

  return (
    <img
      src={asset.src}
      width={asset.width}
      height={asset.height}
      alt={decorative ? "" : asset.alt}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={eager ? "high" : "auto"}
      aria-hidden={decorative ? "true" : undefined}
      className={cn("pointer-events-none select-none object-contain", className)}
    />
  );
}

export function MascotEmptyState({
  kind,
  title,
  children,
  actions,
  className,
  imageClassName,
  compact = false,
}: {
  kind: MascotKind;
  title?: string;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
  imageClassName?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-3xl border border-[#EED8AA]/70 bg-[#FFFCF4]/90",
        compact
          ? "px-5 py-4"
          : "px-6 py-7 shadow-sm sm:px-8 sm:py-8",
        className,
      )}
    >
      <div
        className={cn(
          "flex flex-col items-center gap-5 text-center sm:text-left",
          compact
            ? "sm:flex-row sm:items-center"
            : "sm:flex-row sm:items-center sm:gap-7",
        )}
      >
        <MascotFigure
          kind={kind}
          decorative
          className={cn(
            compact
              ? "h-24 w-24 shrink-0 sm:h-28 sm:w-28"
              : "h-32 w-32 shrink-0 sm:h-40 sm:w-40",
            imageClassName,
          )}
        />
        <div className="min-w-0 flex-1">
          {title ? (
            <div className="text-lg font-semibold tracking-normal text-[#4A2B1B]">
              {title}
            </div>
          ) : null}
          {children ? (
            <div className={cn("leading-7 text-muted-foreground", title && "mt-2")}>
              {children}
            </div>
          ) : null}
          {actions ? (
            <div className="mt-5 flex w-full flex-wrap justify-center gap-3 sm:justify-start">
              {actions}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
