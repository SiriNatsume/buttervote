import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { MascotFigure } from "@/components/mascot";
import { Button } from "@/components/ui/button";

export function GroupAccessDeniedPanel({
  backHref,
  actionLabel = "投票",
}: {
  backHref: string;
  actionLabel?: string;
}) {
  return (
    <div className="butter-panel p-8">
      <div className="flex flex-col items-center gap-6 text-center sm:flex-row sm:items-start sm:text-left">
        <MascotFigure
          kind="restrictedAccess"
          decorative
          className="h-32 w-32 shrink-0 sm:h-40 sm:w-40"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center">
            <div className="rounded-full bg-[#FFF3D0] p-2 text-[#C75F1A]">
              <ShieldAlert className="size-5" />
            </div>
            <h1 className="text-2xl font-semibold tracking-normal">
              你暂时没有参与该活动组{actionLabel}的权限。
            </h1>
          </div>
          <p className="mt-3 leading-7 text-muted-foreground">
            如果你是相关 QQ 群成员，请通过对应 QQ bot 链接重新验证。
          </p>
          <Button asChild className="mt-6">
            <Link href={backHref}>返回</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
