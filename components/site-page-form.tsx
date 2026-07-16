"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, Save } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { MarkdownEditor } from "@/components/markdown-editor";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { LoadingButton } from "@/components/loading-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createSitePageAction,
  updateSitePageAction,
} from "@/lib/actions/site-page-actions";
import { pageVisibilityLabel } from "@/lib/site-pages";
import type { PageVisibility } from "@/lib/types";
import { cn } from "@/lib/utils";

export type SitePageFormValue = {
  id?: string;
  title: string;
  description: string;
  slug: string;
  contentMarkdown: string;
  visibility: PageVisibility;
  updatedAt?: string;
};

function snapshot(value: SitePageFormValue) {
  return JSON.stringify({
    title: value.title,
    description: value.description,
    slug: value.slug,
    contentMarkdown: value.contentMarkdown,
    visibility: value.visibility,
  });
}

export function SitePageForm({ initialValue }: { initialValue: SitePageFormValue }) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue);
  const [savedSnapshot, setSavedSnapshot] = useState(() => snapshot(initialValue));
  const [savedSlug, setSavedSlug] = useState(initialValue.slug);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const dirty = useMemo(() => snapshot(value) !== savedSnapshot, [savedSnapshot, value]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function update<K extends keyof SitePageFormValue>(key: K, next: SitePageFormValue[K]) {
    setValue((current) => ({ ...current, [key]: next }));
  }

  async function uploadAsset(file: File) {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("visibility", "public");
      const response = await fetch("/api/admin/page-assets", {
        method: "POST",
        body: formData,
      });
      const result = (await response.json()) as {
        error?: string;
        markdown?: string;
      };
      if (!response.ok || !result.markdown) {
        throw new Error(result.error || "附件上传失败。");
      }
      toast.success("附件已上传并插入 Markdown");
      return result.markdown;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "附件上传失败。");
      return null;
    } finally {
      setUploading(false);
    }
  }

  function submit() {
    if (value.id && value.slug !== savedSlug) {
      const confirmed = window.confirm(
        "修改 Slug 会使旧页面链接立即失效，第一版不会创建重定向。确认继续吗？",
      );
      if (!confirmed) return;
    }

    startTransition(async () => {
      const input = {
        pageId: value.id,
        title: value.title,
        description: value.description,
        slug: value.slug,
        contentMarkdown: value.contentMarkdown,
        visibility: value.visibility,
        expectedUpdatedAt: value.updatedAt,
      };
      const result = value.id
        ? await updateSitePageAction(input)
        : await createSitePageAction(input);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      const nextValue = {
        ...value,
        id: result.pageId,
        slug: result.slug,
        updatedAt: result.updatedAt,
      };
      setValue(nextValue);
      setSavedSnapshot(snapshot(nextValue));
      setSavedSlug(result.slug);
      toast.success("页面已保存");
      if (result.warning) toast.warning(result.warning);
      if (!initialValue.id) {
        router.push(result.redirectTo);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="page-title">标题</Label>
            <Input
              id="page-title"
              value={value.title}
              maxLength={160}
              onChange={(event) => update("title", event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="page-description">页面摘要</Label>
            <Textarea
              id="page-description"
              value={value.description}
              maxLength={500}
              className="min-h-24"
              onChange={(event) => update("description", event.target.value)}
            />
            <p className="text-right text-xs text-muted-foreground">
              {value.description.length} / 500
            </p>
          </div>
        </div>

        <div className="space-y-5 rounded-2xl border border-[#EED8AA]/70 bg-[#FFFCF4]/90 p-5">
          <div className="space-y-2">
            <Label htmlFor="page-slug">Slug</Label>
            <Input
              id="page-slug"
              value={value.slug}
              maxLength={120}
              placeholder="tournament-rules"
              onChange={(event) => update("slug", event.target.value.toLowerCase())}
            />
            <p className="break-all text-xs text-muted-foreground">
              /pages/{value.slug || "slug"}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="page-visibility">可见性</Label>
            <select
              id="page-visibility"
              value={value.visibility}
              className="flex h-10 w-full rounded-xl border border-input bg-[#FFFCF4]/80 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onChange={(event) =>
                update("visibility", event.target.value as PageVisibility)
              }
            >
              <option value="admin_only">管理可见</option>
              <option value="public">所有人可见</option>
            </select>
          </div>
          <Badge variant={value.visibility === "public" ? "default" : "outline"}>
            {pageVisibilityLabel[value.visibility]}
          </Badge>
          {value.id ? (
            <Button asChild variant="outline" className="w-full">
              <Link href={`/pages/${value.slug}`} target="_blank" rel="noopener noreferrer">
                <Eye className="size-4" />
                打开阅读页
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex gap-2 lg:hidden">
        <Button
          type="button"
          variant={mode === "edit" ? "default" : "outline"}
          onClick={() => setMode("edit")}
        >
          编辑
        </Button>
        <Button
          type="button"
          variant={mode === "preview" ? "default" : "outline"}
          onClick={() => setMode("preview")}
        >
          <Eye className="size-4" />
          预览
        </Button>
      </div>

      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <div className={cn(mode !== "edit" && "hidden", "min-w-0 lg:block")}>
          <MarkdownEditor
            value={value.contentMarkdown}
            onChange={(next) => update("contentMarkdown", next)}
            onUpload={uploadAsset}
            uploading={uploading}
          />
        </div>
        <div
          className={cn(
            mode !== "preview" && "hidden",
            "min-h-[620px] min-w-0 rounded-xl border border-[#EED8AA]/70 bg-white/70 p-5 lg:block lg:p-8",
          )}
        >
          {value.contentMarkdown ? (
            <MarkdownRenderer source={value.contentMarkdown} />
          ) : (
            <p className="text-sm text-muted-foreground">预览将在这里显示。</p>
          )}
        </div>
      </div>

      <div className="sticky bottom-4 z-20 flex items-center justify-between gap-4 rounded-2xl border border-[#EED8AA] bg-[#FFFCF4]/95 p-4 shadow-lg backdrop-blur">
        <span className="text-sm text-muted-foreground">
          {dirty ? "有未保存的修改" : "所有修改已保存"}
        </span>
        <LoadingButton
          type="button"
          loading={pending}
          loadingText="保存中…"
          disabled={!dirty || uploading}
          onClick={submit}
        >
          <Save className="size-4" />
          保存页面
        </LoadingButton>
      </div>
    </div>
  );
}
