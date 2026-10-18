import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

type PageLoadingSkeletonProps = {
  variant?: "cards" | "detail" | "form" | "table";
};

function SkeletonBlock({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-2xl border border-[#EED8AA]/70 bg-[#FFF8E8]/80",
        className,
      )}
    />
  );
}

function SkeletonContent({
  variant = "cards",
}: PageLoadingSkeletonProps) {
  if (variant === "table") {
    return (
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-12 sm:px-6">
        <div className="space-y-3">
          <SkeletonBlock className="h-9 w-48" />
          <SkeletonBlock className="h-5 w-72" />
        </div>
        <div className="rounded-2xl border border-[#EED8AA]/70 bg-[#FFFCF4]/90 p-6 shadow-sm">
          <SkeletonBlock className="mb-4 h-8 w-32" />
          <div className="space-y-3">
            {[0, 1, 2, 3].map((item) => (
              <SkeletonBlock key={item} className="h-14 w-full" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (variant === "form") {
    return (
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-12 sm:px-6">
        <SkeletonBlock className="h-10 w-2/3" />
        <div className="rounded-2xl border border-[#EED8AA]/70 bg-[#FFFCF4]/90 p-6 shadow-sm">
          <div className="space-y-4">
            <SkeletonBlock className="h-10 w-full" />
            <SkeletonBlock className="h-28 w-full" />
            <SkeletonBlock className="h-10 w-40" />
          </div>
        </div>
      </div>
    );
  }

  if (variant === "detail") {
    return (
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-12 sm:px-6">
        <SkeletonBlock className="aspect-video w-full" />
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((item) => (
            <SkeletonBlock key={item} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-12 sm:px-6">
      <SkeletonBlock className="h-72 w-full" />
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((item) => (
          <SkeletonBlock key={item} className="h-72" />
        ))}
      </div>
    </div>
  );
}

export function PageLoadingSkeleton(props: PageLoadingSkeletonProps) {
  return (
    <div className="relative w-full min-w-0" role="status" aria-label="正在加载页面">
      <div aria-hidden="true">
        <SkeletonContent {...props} />
      </div>
      <div className="route-loading-recovery absolute inset-x-4 top-24 z-10 mx-auto max-w-md rounded-2xl border border-[#EED8AA] bg-[#FFFCF4] p-5 text-center shadow-sm sm:inset-x-6">
        <p className="font-semibold">页面加载时间较长</p>
        <p className="mb-4 mt-2 text-sm text-muted-foreground">
          网络可能较慢，请重新加载后再试。
        </p>
        {/* A native link works even when the browser cannot load JavaScript. */}
        <a href="" className={buttonVariants({ size: "sm" })}>
          重新加载
        </a>
      </div>
    </div>
  );
}
