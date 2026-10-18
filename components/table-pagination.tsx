import Link from "next/link";
import { Button } from "@/components/ui/button";

function PageLink({ href, children }: { href: string | null; children: string }) {
  return href ? (
    <Button asChild variant="outline" size="sm">
      <Link href={href} prefetch={false}>{children}</Link>
    </Button>
  ) : <Button type="button" variant="outline" size="sm" disabled>{children}</Button>;
}

export function TablePagination({
  label, totalCount, itemCount, previousHref, nextHref, pageLabel,
}: {
  label: string;
  totalCount: number;
  itemCount: number;
  previousHref: string | null;
  nextHref: string | null;
  pageLabel?: string;
}) {
  return (
    <nav aria-label={label} className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
      <span>{pageLabel ?? `本页 ${itemCount} 条`} · 共 {totalCount.toLocaleString("zh-CN")} 条</span>
      <div className="flex items-center gap-2">
        <PageLink href={previousHref}>上一页</PageLink>
        <PageLink href={nextHref}>下一页</PageLink>
      </div>
    </nav>
  );
}
