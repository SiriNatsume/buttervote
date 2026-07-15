"use client";

import { FormEvent, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  GripVertical,
  Pencil,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  deleteHallOfFameEntryAction,
  reorderHallOfFameEntriesAction,
} from "@/lib/actions/hall-of-fame-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingButton } from "@/components/loading-button";
import {
  HALL_OF_FAME_IMAGE_TYPES,
  HALL_OF_FAME_MAX_FILE_SIZE,
  HALL_OF_FAME_THUMBNAIL_MAX_FILE_SIZE,
} from "@/lib/hall-of-fame";
import { getImageThumbnailBlob } from "@/lib/image/crop-image";

export type HallOfFameAdminEntry = {
  id: string;
  contestId: string | null;
  eventTitle: string;
  winnerName: string;
  description: string;
  posterUrl: string;
  posterSize: number;
  thumbnailUrl: string;
  thumbnailSize: number;
};

type ContestOption = { id: string; title: string };
type EditorValue = {
  entryId: string | null;
  contestId: string;
  eventTitle: string;
  winnerName: string;
  description: string;
  posterUrl: string | null;
};

const emptyEditor: EditorValue = {
  entryId: null,
  contestId: "",
  eventTitle: "",
  winnerName: "",
  description: "",
  posterUrl: null,
};

export function HallOfFameAdmin({
  entries,
  contests,
}: {
  entries: HallOfFameAdminEntry[];
  contests: ContestOption[];
}) {
  const router = useRouter();
  const [orderedEntries, setOrderedEntries] = useState(entries);
  const [orderDirty, setOrderDirty] = useState(false);
  const [editor, setEditor] = useState<EditorValue | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setOrderedEntries(entries);
    setOrderDirty(false);
  }, [entries]);

  function editEntry(entry: HallOfFameAdminEntry) {
    setEditor({
      entryId: entry.id,
      contestId: entry.contestId ?? "",
      eventTitle: entry.eventTitle,
      winnerName: entry.winnerName,
      description: entry.description,
      posterUrl: entry.posterUrl,
    });
  }

  function moveEntry(index: number, offset: -1 | 1) {
    const destination = index + offset;
    if (destination < 0 || destination >= orderedEntries.length) return;
    setOrderedEntries((current) => {
      const next = [...current];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
    setOrderDirty(true);
  }

  function dropBefore(targetId: string) {
    if (!draggingId || draggingId === targetId) return;
    setOrderedEntries((current) => {
      const sourceIndex = current.findIndex((entry) => entry.id === draggingId);
      const targetIndex = current.findIndex((entry) => entry.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const next = [...current];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
    setOrderDirty(true);
    setDraggingId(null);
  }

  function saveOrder() {
    startTransition(async () => {
      const result = await reorderHallOfFameEntriesAction(
        orderedEntries.map((entry) => entry.id),
      );
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setOrderDirty(false);
      toast.success(result.message);
      router.refresh();
    });
  }

  function deleteEntry(entry: HallOfFameAdminEntry) {
    if (!window.confirm(`确定删除「${entry.winnerName}」及其海报文件吗？此操作不可撤销。`)) {
      return;
    }
    startTransition(async () => {
      const result = await deleteHallOfFameEntryAction(entry.id);
      if (!result.ok) {
        toast.error(result.error);
        router.refresh();
        return;
      }
      if (result.warning) {
        toast.warning(result.warning);
      } else {
        toast.success(result.message);
      }
      router.refresh();
    });
  }

  async function submitEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    setSubmitting(true);
    try {
      const formData = new FormData(event.currentTarget);
      if (editor.entryId) formData.set("entryId", editor.entryId);
      const poster = formData.get("poster");
      if (poster instanceof File && poster.size > 0) {
        if (
          !HALL_OF_FAME_IMAGE_TYPES.includes(
            poster.type as (typeof HALL_OF_FAME_IMAGE_TYPES)[number],
          ) ||
          poster.size > HALL_OF_FAME_MAX_FILE_SIZE
        ) {
          throw new Error("仅支持 20MB 以内的 JPEG、PNG 或 WebP 图片。");
        }

        const thumbnail = await getImageThumbnailBlob(poster, {
          maxWidth: 480,
          maxHeight: 640,
          maxSizeBytes: HALL_OF_FAME_THUMBNAIL_MAX_FILE_SIZE,
        });
        const extension = thumbnail.blob.type === "image/jpeg" ? "jpg" : "webp";
        formData.set("thumbnail", thumbnail.blob, `thumbnail.${extension}`);
      }
      const response = await fetch("/api/admin/hall-of-fame", {
        method: "POST",
        body: formData,
      });
      const result = (await response.json()) as { ok?: boolean; error?: string; warning?: string };
      if (!response.ok) throw new Error(result.error || "保存失败。");
      if (result.warning) {
        toast.warning(result.warning);
      } else {
        toast.success(editor.entryId ? "冠军英灵殿条目已更新。" : "冠军英灵殿条目已创建。");
      }
      setEditor(null);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          拖拽或使用箭头调整顺序，公开页面将从左到右展示。
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <LoadingButton
            type="button"
            variant="outline"
            loading={pending}
            loadingText="保存中..."
            disabled={!orderDirty}
            onClick={saveOrder}
          >
            <Save />保存排序
          </LoadingButton>
          <Button type="button" onClick={() => setEditor({ ...emptyEditor })}>
            <Plus />新增条目
          </Button>
        </div>
      </div>

      {orderedEntries.length > 0 ? (
        <div className="grid gap-3">
          {orderedEntries.map((entry, index) => (
            <div
              key={entry.id}
              draggable
              onDragStart={() => setDraggingId(entry.id)}
              onDragEnd={() => setDraggingId(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => dropBefore(entry.id)}
              className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-3 rounded-2xl border border-[#EED8AA]/70 bg-[#FFF8E8]/60 p-3 sm:grid-cols-[auto_4.5rem_minmax(0,1fr)_auto]"
            >
              <GripVertical className="hidden cursor-grab text-muted-foreground sm:block" aria-label="拖拽排序" />
              <button
                type="button"
                onClick={() => setPreviewUrl(entry.posterUrl)}
                className="h-24 w-[4.5rem] shrink-0 overflow-hidden rounded-lg bg-[#F6E9CE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                aria-label={`预览${entry.winnerName}的海报`}
              >
                <img
                  src={entry.thumbnailUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs text-muted-foreground">{entry.eventTitle}</div>
                <div className="truncate font-semibold text-[#5C321E]">{entry.winnerName}</div>
                <div className="truncate text-sm text-muted-foreground">{entry.description || "暂无简介"}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  原图 {(entry.posterSize / 1024 / 1024).toFixed(2)} MB · 缩略图 {Math.round(entry.thumbnailSize / 1024)} KB
                </div>
              </div>
              <div className="col-span-2 flex flex-wrap justify-end gap-1 border-t border-[#EED8AA]/60 pt-2 sm:col-span-1 sm:border-0 sm:pt-0">
                <Button type="button" variant="ghost" size="icon" onClick={() => moveEntry(index, -1)} disabled={index === 0} aria-label="上移">
                  <ArrowUp />
                </Button>
                <Button type="button" variant="ghost" size="icon" onClick={() => moveEntry(index, 1)} disabled={index === orderedEntries.length - 1} aria-label="下移">
                  <ArrowDown />
                </Button>
                <Button type="button" variant="ghost" size="icon" onClick={() => setPreviewUrl(entry.posterUrl)} aria-label="预览海报">
                  <Eye />
                </Button>
                <Button type="button" variant="ghost" size="icon" onClick={() => editEntry(entry)} aria-label="编辑">
                  <Pencil />
                </Button>
                <Button type="button" variant="destructive" size="icon" onClick={() => deleteEntry(entry)} disabled={pending} aria-label="删除">
                  <Trash2 />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-[#E3C98F] px-6 py-14 text-center text-muted-foreground">
          暂无冠军英灵殿条目，点击“新增条目”上传第一张海报。
        </div>
      )}

      <Dialog open={Boolean(editor)} onOpenChange={(open) => !open && setEditor(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editor?.entryId ? "编辑冠军英灵殿条目" : "新增冠军英灵殿条目"}</DialogTitle>
            <DialogDescription>展示信息独立保存，不会随关联赛事自动变化。</DialogDescription>
          </DialogHeader>
          {editor ? (
            <form className="grid gap-4" onSubmit={submitEditor}>
              <div className="grid gap-2">
                <Label htmlFor="hall-contest">关联赛事（可选）</Label>
                <select
                  id="hall-contest"
                  name="contestId"
                  value={editor.contestId}
                  onChange={(event) => setEditor({ ...editor, contestId: event.target.value })}
                  className="h-10 rounded-xl border border-input bg-[#FFFCF4]/80 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">不关联赛事</option>
                  {contests.map((contest) => <option key={contest.id} value={contest.id}>{contest.title}</option>)}
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="hall-event-title">赛事标题</Label>
                <Input id="hall-event-title" name="eventTitle" maxLength={120} required value={editor.eventTitle} onChange={(event) => setEditor({ ...editor, eventTitle: event.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="hall-winner-name">胜者名</Label>
                <Input id="hall-winner-name" name="winnerName" maxLength={120} required value={editor.winnerName} onChange={(event) => setEditor({ ...editor, winnerName: event.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="hall-description">简介</Label>
                <Input id="hall-description" name="description" maxLength={200} value={editor.description} onChange={(event) => setEditor({ ...editor, description: event.target.value })} placeholder="卡片中单行显示" />
              </div>
              {editor.posterUrl ? (
                <button type="button" onClick={() => setPreviewUrl(editor.posterUrl)} className="mx-auto overflow-hidden rounded-xl border border-[#EED8AA]">
                  <img src={editor.posterUrl} alt="当前海报预览" className="h-48 w-36 object-cover" />
                </button>
              ) : null}
              <div className="grid gap-2">
                <Label htmlFor="hall-poster">{editor.entryId ? "替换海报（可选）" : "海报"}</Label>
                <Input id="hall-poster" name="poster" type="file" accept="image/jpeg,image/png,image/webp" required={!editor.entryId} />
                <p className="text-xs text-muted-foreground">
                  JPEG、PNG 或 WebP，最大 20 MB；保留原图，并自动生成轻量缩略图。
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setEditor(null)}>取消</Button>
                <LoadingButton type="submit" loading={submitting} loadingText="保存中...">保存</LoadingButton>
              </div>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(previewUrl)} onOpenChange={(open) => !open && setPreviewUrl(null)}>
        <DialogContent aria-describedby={undefined} className="flex h-[calc(100dvh-2rem)] max-w-6xl items-center justify-center overflow-hidden border-0 bg-[#211711]/95 p-3 sm:p-5">
          <DialogTitle className="sr-only">预览海报</DialogTitle>
          {previewUrl ? <img src={previewUrl} alt="海报预览" className="max-h-full max-w-full object-contain" /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
