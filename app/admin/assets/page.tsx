import { PageAssetsManager } from "@/components/page-assets-manager";
import { requireAdmin } from "@/lib/auth";
import { createRequiredServiceClient } from "@/lib/supabase/service";

export default async function AdminAssetsPage() {
  await requireAdmin();
  const supabase = createRequiredServiceClient();
  const { data: assets, error } = await supabase
    .from("page_assets")
    .select(
      "id,original_filename,extension,mime_type,byte_size,asset_type,visibility,created_at",
    )
    .order("created_at", { ascending: false });

  if (error) throw new Error(`附件列表读取失败：${error.message}`);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-normal">附件管理</h1>
        <p className="mt-3 text-muted-foreground">
          管理 Markdown 页面使用的全站附件。删除附件不会检查页面引用。
        </p>
      </div>
      <PageAssetsManager initialAssets={assets ?? []} />
    </div>
  );
}
