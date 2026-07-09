import Link from "next/link";
import { MascotEmptyState } from "@/components/mascot";
import { Button } from "@/components/ui/button";

export default function NotFoundPage() {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-12rem)] max-w-3xl items-center px-4 py-12 sm:px-6">
      <MascotEmptyState
        kind="emptyContests"
        title="没有找到这个页面"
        actions={
          <Button asChild>
            <Link href="/">返回首页</Link>
          </Button>
        }
      >
        链接可能已经失效，或内容暂时不可访问。
      </MascotEmptyState>
    </div>
  );
}
