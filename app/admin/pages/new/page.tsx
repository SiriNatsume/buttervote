import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SitePageForm } from "@/components/site-page-form";
import { Button } from "@/components/ui/button";
import { requireAdmin } from "@/lib/auth";

export default async function NewSitePagePage() {
  await requireAdmin();
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="mb-8">
        <Button asChild variant="ghost" className="mb-4">
          <Link href="/admin/pages">
            <ArrowLeft className="size-4" />
            返回页面列表
          </Link>
        </Button>
        <h1 className="text-3xl font-semibold tracking-normal">新建页面</h1>
      </div>
      <SitePageForm
        initialValue={{
          title: "",
          description: "",
          slug: "",
          contentMarkdown: "",
          visibility: "admin_only",
        }}
      />
    </div>
  );
}
