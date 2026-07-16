"use client";

import {
  Copy,
  Download,
  FileArchive,
  FileText,
  ImageIcon,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { LoadingButton } from "@/components/loading-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setPageAssetVisibilityAction } from "@/lib/actions/page-asset-actions";
import {
  pageAssetMarkdown,
  pageAssetUrl,
  pageAssetVisibilityLabel,
} from "@/lib/page-assets";
import { formatDateTime } from "@/lib/time";
import type { PageAsset, PageAssetType, PageVisibility } from "@/lib/types";

type AssetItem = Pick<
  PageAsset,
  | "id"
  | "original_filename"
  | "extension"
  | "mime_type"
  | "byte_size"
  | "asset_type"
  | "visibility"
  | "created_at"
>;

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function AssetIcon({ type, extension }: { type: PageAssetType; extension: string }) {
  if (type === "image") return <ImageIcon className="size-6" />;
  if (["7z", "rar"].includes(extension)) return <FileArchive className="size-6" />;
  return <FileText className="size-6" />;
}

export function PageAssetsManager({ initialAssets }: { initialAssets: AssetItem[] }) {
  const [assets, setAssets] = useState(initialAssets);
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"all" | PageAssetType>("all");
  const [visibility, setVisibility] = useState<"all" | PageVisibility>("all");
  const [uploadVisibility, setUploadVisibility] = useState<PageVisibility>("public");
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return assets.filter(
      (asset) =>
        (!normalized || asset.original_filename.toLowerCase().includes(normalized)) &&
        (type === "all" || asset.asset_type === type) &&
        (visibility === "all" || asset.visibility === visibility),
    );
  }, [assets, query, type, visibility]);

  async function upload(file: File) {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("visibility", uploadVisibility);
      const response = await fetch("/api/admin/page-assets", {
        method: "POST",
        body: formData,
      });
      const result = (await response.json()) as { error?: string; asset?: AssetItem };
      if (!response.ok || !result.asset) {
        throw new Error(result.error || "附件上传失败。");
      }
      setAssets((current) => [result.asset!, ...current]);
      toast.success("附件已上传");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "附件上传失败。");
    } finally {
      setUploading(false);
    }
  }

  function changeVisibility(asset: AssetItem, next: PageVisibility) {
    startTransition(async () => {
      const result = await setPageAssetVisibilityAction({
        assetId: asset.id,
        visibility: next,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setAssets((current) =>
        current.map((item) =>
          item.id === asset.id ? { ...item, visibility: next } : item,
        ),
      );
      toast.success("附件可见性已更新");
    });
  }

  async function remove(asset: AssetItem) {
    const confirmed = window.confirm(
      `确定永久删除“${asset.original_filename}”吗？\n\n引用该附件的页面将出现失效链接，系统不会检查或阻止删除。`,
    );
    if (!confirmed) return;

    const response = await fetch(`/api/admin/page-assets/${asset.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true }),
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) {
      toast.error(result.error || "附件删除失败。");
      return;
    }
    setAssets((current) => current.filter((item) => item.id !== asset.id));
    toast.success("附件已永久删除");
  }

  async function copyMarkdown(asset: AssetItem) {
    await navigator.clipboard.writeText(
      pageAssetMarkdown({
        id: asset.id,
        filename: asset.original_filename,
        assetType: asset.asset_type,
      }),
    );
    toast.success("Markdown 已复制");
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-[#EED8AA]/70 bg-[#FFFCF4]/90 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-semibold text-[#4A2B1B]">上传附件</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              图片最大 10 MB；PDF、压缩包和 Office 文件最大 50 MB。
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              value={uploadVisibility}
              className="h-10 rounded-xl border border-input bg-[#FFFCF4] px-3 text-sm"
              onChange={(event) =>
                setUploadVisibility(event.target.value as PageVisibility)
              }
            >
              <option value="public">所有人可见</option>
              <option value="admin_only">管理可见</option>
            </select>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".jpg,.jpeg,.png,.webp,.pdf,.7z,.rar,.xlsx,.docx,.pptx"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) upload(file);
                event.target.value = "";
              }}
            />
            <LoadingButton
              type="button"
              loading={uploading}
              loadingText="上传中…"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="size-4" />
              选择文件
            </LoadingButton>
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_180px]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            className="pl-9"
            placeholder="搜索文件名"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <select
          value={type}
          className="h-10 rounded-xl border border-input bg-[#FFFCF4] px-3 text-sm"
          onChange={(event) => setType(event.target.value as typeof type)}
        >
          <option value="all">全部类型</option>
          <option value="image">图片</option>
          <option value="attachment">附件</option>
        </select>
        <select
          value={visibility}
          className="h-10 rounded-xl border border-input bg-[#FFFCF4] px-3 text-sm"
          onChange={(event) => setVisibility(event.target.value as typeof visibility)}
        >
          <option value="all">全部可见性</option>
          <option value="public">所有人可见</option>
          <option value="admin_only">管理可见</option>
        </select>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((asset) => (
          <div
            key={asset.id}
            className="overflow-hidden rounded-2xl border border-[#EED8AA]/70 bg-[#FFFCF4]/90"
          >
            <div className="flex aspect-video items-center justify-center overflow-hidden bg-[#FFF8E8]">
              {asset.asset_type === "image" ? (
                <img
                  src={pageAssetUrl(asset.id)}
                  alt={asset.original_filename}
                  className="size-full object-contain"
                  loading="lazy"
                />
              ) : (
                <AssetIcon type={asset.asset_type} extension={asset.extension} />
              )}
            </div>
            <div className="space-y-3 p-4">
              <div>
                <div className="truncate font-medium" title={asset.original_filename}>
                  {asset.original_filename}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {asset.extension.toUpperCase()} · {formatBytes(asset.byte_size)} · {formatDateTime(asset.created_at)}
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <Badge variant={asset.visibility === "public" ? "default" : "outline"}>
                  {pageAssetVisibilityLabel[asset.visibility]}
                </Badge>
                <select
                  value={asset.visibility}
                  disabled={pending}
                  className="h-8 rounded-lg border border-input bg-white px-2 text-xs"
                  aria-label={`修改 ${asset.original_filename} 的可见性`}
                  onChange={(event) =>
                    changeVisibility(asset, event.target.value as PageVisibility)
                  }
                >
                  <option value="public">所有人可见</option>
                  <option value="admin_only">管理可见</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => copyMarkdown(asset)}>
                  <Copy className="size-4" />
                  Markdown
                </Button>
                <Button asChild size="sm" variant="outline">
                  <a href={pageAssetUrl(asset.id, true)}>
                    <Download className="size-4" />
                    下载
                  </a>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  className="col-span-2"
                  onClick={() => remove(asset)}
                >
                  <Trash2 className="size-4" />
                  永久删除
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#DFCBA5] py-12 text-center text-sm text-muted-foreground">
          没有匹配的附件。
        </div>
      ) : null}
    </div>
  );
}
