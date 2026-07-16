import Link from "next/link";
import { ExternalLink, FilePlus2, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth";
import { pageVisibilityLabel } from "@/lib/site-pages";
import { createRequiredServiceClient } from "@/lib/supabase/service";
import { formatDateTime } from "@/lib/time";

export default async function AdminPagesPage() {
  await requireAdmin();
  const supabase = createRequiredServiceClient();
  const { data: pages, error } = await supabase
    .from("site_pages")
    .select("id,title,description,slug,visibility,published_at,updated_at")
    .order("updated_at", { ascending: false });

  if (error) throw new Error(`页面列表读取失败：${error.message}`);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-normal">页面</h1>
          <p className="mt-3 text-muted-foreground">
            管理全站 Markdown 页面。页面不能删除，只能调整可见性。
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/pages/new">
            <FilePlus2 className="size-4" />
            新建页面
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>全部页面</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {pages && pages.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>页面</TableHead>
                  <TableHead>可见性</TableHead>
                  <TableHead>首次公开</TableHead>
                  <TableHead>最后更新</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pages.map((page) => (
                  <TableRow key={page.id}>
                    <TableCell className="min-w-[260px]">
                      <div className="font-medium text-[#4A2B1B]">{page.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        /pages/{page.slug}
                      </div>
                      {page.description ? (
                        <p className="mt-2 line-clamp-2 max-w-xl text-sm text-muted-foreground">
                          {page.description}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant={page.visibility === "public" ? "default" : "outline"}>
                        {pageVisibilityLabel[page.visibility]}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {page.published_at ? formatDateTime(page.published_at) : "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatDateTime(page.updated_at)}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button asChild size="sm" variant="outline">
                          <Link
                            href={`/pages/${page.slug}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <ExternalLink className="size-4" />
                            阅读
                          </Link>
                        </Button>
                        <Button asChild size="sm">
                          <Link href={`/admin/pages/${page.id}/edit`}>
                            <Pencil className="size-4" />
                            编辑
                          </Link>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">
              还没有页面。
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
