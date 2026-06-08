import Link from "next/link";
import { ShieldAlert } from "lucide-react";
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
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-[#FFF3D0] p-2 text-[#C75F1A]">
          <ShieldAlert className="size-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-normal">
            你暂时没有参与该活动组{actionLabel}的权限。
          </h1>
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
