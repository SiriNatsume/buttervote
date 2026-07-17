import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { SitePageForm } from "@/components/site-page-form";
import { Button } from "@/components/ui/button";
import { requireAdmin } from "@/lib/auth";
import { createRequiredServiceClient } from "@/lib/supabase/service";

export default async function EditSitePagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const supabase = createRequiredServiceClient();
  const { data: page, error } = await supabase
    .from("site_pages")
    .select("id,title,description,slug,content_markdown,visibility,updated_at")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`页面读取失败：${error.message}`);
  if (!page) notFound();

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="mb-8">
        <Button asChild variant="ghost" className="mb-4">
          <Link href="/admin/pages">
            <ArrowLeft className="size-4" />
            返回页面列表
          </Link>
        </Button>
        <h1 className="text-3xl font-semibold tracking-normal">编辑页面</h1>
      </div>
      <SitePageForm
        initialValue={{
          id: page.id,
          title: page.title,
          description: page.description ?? "",
          slug: page.slug,
          contentMarkdown: page.content_markdown,
          visibility: page.visibility,
          updatedAt: page.updated_at,
        }}
      />
    </div>
  );
}
