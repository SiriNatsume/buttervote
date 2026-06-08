import { cn } from "@/lib/utils";

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

export function PageLoadingSkeleton({
  variant = "cards",
}: {
  variant?: "cards" | "detail" | "form" | "table";
}) {
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
