"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, ImagePlus, Plus, Search, Trash2 } from "lucide-react";
import { createNominationAction } from "@/lib/actions/nomination-actions";
import { toUserFacingError } from "@/lib/action-error";
import { getPublicImageUrl } from "@/lib/image/image-url";
import {
  createNominationDraft,
  getNominationDraftError,
  hasNominationDraftContent,
  nominationDraftImagePath,
  nominationDraftStorageKey,
  restoreNominationDrafts,
  serializeNominationDrafts,
  type NominationDraft,
} from "@/lib/nomination-drafts";
import { formatDateTime } from "@/lib/time";
import type { NominationStatus } from "@/lib/types";
import type { ExistingNomination } from "@/components/existing-nominations-list";
import { DescriptionTextarea } from "@/components/description-textarea";
import { LoadingButton } from "@/components/loading-button";
import { ImageCropUpload } from "@/components/image-crop-upload";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type DraftEntry = NominationDraft & {
  expanded: boolean;
  state: "editing" | "submitting" | "success" | "error";
  error: string | null;
  submittedStatus?: NominationStatus;
};

function toDraftEntry(draft: NominationDraft): DraftEntry {
  return { ...draft, expanded: true, state: "editing", error: null };
}

const nominationStatusLabel: Record<ExistingNomination["status"], string> = {
  draft: "待上传图片",
  pending: "待审核",
  approved: "已通过",
  rejected: "已拒绝",
};

function normalizeSearch(value: string) {
  return value.trim().toLowerCase();
}

function findSimilarNominations(
  nominations: ExistingNomination[],
  candidateName: string,
) {
  const query = normalizeSearch(candidateName);

  if (!query) {
    return [];
  }

  return nominations
    .filter((nomination) => {
      const haystack = [nomination.name, nomination.description]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(query) || query.includes(nomination.name.toLowerCase());
    })
    .slice(0, 5);
}

function DuplicateNominationHint({
  candidateName,
  nominations,
  showNominatorInfo,
}: {
  candidateName: string;
  nominations: ExistingNomination[];
  showNominatorInfo: boolean;
}) {
  const query = normalizeSearch(candidateName);
  const matches = useMemo(
    () => findSimilarNominations(nominations, candidateName),
    [candidateName, nominations],
  );

  if (!query) {
    return null;
  }

  if (matches.length === 0) {
    return (
      <div className="rounded-2xl border border-[#EED8AA]/70 bg-[#FFF8E8]/70 px-4 py-3 text-sm text-muted-foreground">
        暂未发现相似的已有提名。
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50/80 p-4">
      <div className="flex items-start gap-2 text-sm font-medium text-amber-900">
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
        找到 {matches.length} 条可能相似的已有提名，请确认是否重复。
      </div>
      <div className="mt-3 space-y-2">
        {matches.map((nomination) => (
          <div
            key={nomination.id}
            className="rounded-xl border border-amber-200 bg-white/70 p-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="break-words font-medium text-amber-950">
                  {nomination.name}
                </div>
                <p className="mt-1 line-clamp-2 break-words text-xs leading-5 text-amber-900/80">
                  {nomination.description || "暂无简介。"}
                </p>
              </div>
              <Badge variant="secondary">
                {nominationStatusLabel[nomination.status]}
              </Badge>
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-amber-900/70">
              {showNominatorInfo && nomination.nominator_display_name ? (
                <span>提名者：{nomination.nominator_display_name}</span>
              ) : null}
              <span>提交时间：{formatDateTime(nomination.created_at)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function NominationCreateForm({
  contestId,
  userId,
  descriptionMaxLength,
  imageRequired,
  existingNominations,
  showNominatorInfo,
  maxNominations = null,
  initialNominationCount = 0,
  submittedNominationIds = [],
  nominationCountError,
}: {
  contestId: string;
  userId: string;
  descriptionMaxLength?: number | null;
  imageRequired?: boolean;
  existingNominations: ExistingNomination[];
  showNominatorInfo: boolean;
  maxNominations?: number | null;
  initialNominationCount?: number;
  submittedNominationIds?: string[];
  nominationCountError?: string | null;
}) {
  const router = useRouter();
  const [entries, setEntries] = useState<DraftEntry[]>([]);
  const [nominatorDisplayName, setNominatorDisplayName] = useState("");
  const [ready, setReady] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [restoredCount, setRestoredCount] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [busyImages, setBusyImages] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const submittingRef = useRef(false);
  const focusIdRef = useRef<string | null>(null);
  const initialSubmittedIdsRef = useRef(submittedNominationIds);
  const initiallyHasRoomRef = useRef(maxNominations === null || initialNominationCount < maxNominations);
  const storageKey = nominationDraftStorageKey(userId, contestId);
  const requiresImage = imageRequired === true;

  useEffect(() => {
    try {
      const saved = restoreNominationDrafts(
        window.localStorage.getItem(storageKey),
        userId,
        contestId,
        new Set(initialSubmittedIdsRef.current),
      );
      setNominatorDisplayName(saved?.nominatorDisplayName ?? "");
      setRestoredCount(saved?.drafts.length ?? 0);
      setEntries((saved?.drafts.length ? saved.drafts : initiallyHasRoomRef.current ? [createNominationDraft()] : []).map(toDraftEntry));
    } catch {
      setSaveError(true);
      setEntries(initiallyHasRoomRef.current ? [toDraftEntry(createNominationDraft())] : []);
    }
    setReady(true);
  }, [contestId, storageKey, userId]);

  useEffect(() => {
    if (!ready) return;
    function save() {
      try {
        window.localStorage.setItem(storageKey, serializeNominationDrafts({
          version: 1,
          userId,
          contestId,
          nominatorDisplayName,
          drafts: entries.filter((entry) => entry.state !== "success"),
        }));
        setSaveError(false);
      } catch {
        setSaveError(true);
      }
    }
    save();
    window.addEventListener("pagehide", save);
    return () => window.removeEventListener("pagehide", save);
  }, [contestId, entries, nominatorDisplayName, ready, storageKey, userId]);

  useEffect(() => {
    if (!focusIdRef.current) return;
    document.getElementById(`nomination-name-${focusIdRef.current}`)?.focus();
    focusIdRef.current = null;
  }, [entries]);

  const setImageBusy = useCallback((id: string, busy: boolean) => {
    setBusyImages((current) => {
      if (current.has(id) === busy) return current;
      const next = new Set(current);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  function updateEntry(id: string, patch: Partial<DraftEntry>) {
    setEntries((current) => current.map((entry) => entry.id === id ? { ...entry, ...patch } : entry));
    if ("name" in patch || "description" in patch || ("image" in patch && patch.state === "editing")) {
      setMessage("");
    }
  }

  const successes = entries.filter((entry) => entry.state === "success");
  const knownIds = new Set(submittedNominationIds);
  const usedCount = initialNominationCount + successes.filter(
    (entry) => !knownIds.has(entry.id) && entry.submittedStatus !== "rejected",
  ).length;
  const remaining = maxNominations === null ? null : Math.max(0, maxNominations - usedCount);
  const pending = entries.filter((entry) => entry.state !== "success" && hasNominationDraftContent(entry));
  const editableCount = entries.filter((entry) => entry.state !== "success" && !knownIds.has(entry.id)).length;
  const newPendingCount = pending.filter((entry) => !knownIds.has(entry.id)).length;
  const overLimit = remaining !== null && newPendingCount > remaining;
  const canAdd = remaining === null || editableCount < remaining;

  function addEntry() {
    if (!canAdd || isSubmitting) return;
    const draft = toDraftEntry(createNominationDraft());
    focusIdRef.current = draft.id;
    setEntries((current) => [
      ...current.map((entry) => !busyImages.has(entry.id) && hasNominationDraftContent(entry) &&
        !getNominationDraftError(entry, requiresImage, descriptionMaxLength)
        ? { ...entry, expanded: false }
        : entry),
      draft,
    ]);
    setMessage("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current || busyImages.size > 0 || !pending.length || nominationCountError) return;
    if (overLimit) {
      setMessage("本次提名数量超过剩余名额，请移除部分草稿后再提交。");
      return;
    }
    const errors = new Map(pending.map((entry) => [
      entry.id, getNominationDraftError(entry, requiresImage, descriptionMaxLength),
    ]));
    if (Array.from(errors.values()).some(Boolean)) {
      setEntries((current) => current.map((entry) => {
        const error = errors.get(entry.id);
        return error ? { ...entry, error, state: "error", expanded: true } : entry;
      }));
      setMessage("请补全标出的提名后再提交。");
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    setMessage("");
    let successCount = 0;
    try {
      for (const entry of pending) {
        updateEntry(entry.id, { state: "submitting", error: null });
        const formData = new FormData();
        formData.set("contestId", contestId);
        formData.set("nominationId", entry.id);
        formData.set("name", entry.name);
        formData.set("description", entry.description);
        formData.set("nominator_display_name", nominatorDisplayName);
        if (entry.image) {
          for (const [key, value] of Object.entries(entry.image)) formData.set(key, String(value));
        }
        try {
          const result = await createNominationAction(formData);
          if (!result.ok) {
            updateEntry(entry.id, { state: "error", error: toUserFacingError(result.error), expanded: true });
            continue;
          }
          successCount += 1;
          updateEntry(entry.id, {
            state: "success",
            error: null,
            expanded: false,
            submittedStatus: result.nominationStatus,
            name: result.name,
            description: result.description ?? "",
            image: entry.image && result.imagePath ? { ...entry.image, imagePath: result.imagePath } : null,
          });
        } catch (error) {
          updateEntry(entry.id, {
            state: "error",
            error: toUserFacingError(error instanceof Error ? error.message : undefined),
            expanded: true,
          });
        }
      }
      const failedCount = pending.length - successCount;
      setMessage(failedCount
        ? `已提交 ${successCount} 条，${failedCount} 条未成功。内容已保留，可以重试。`
        : remaining !== null && successCount >= remaining
          ? `已提交 ${successCount} 条提名，提名名额已用完。`
          : `已提交 ${successCount} 条提名，可以继续添加。`);
      if (successCount > 0) router.refresh();
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      <div className="space-y-3 rounded-2xl border border-[#EED8AA]/70 bg-[#FFF8E8]/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>已提交 {usedCount}{maxNominations === null ? " 条 · 不限数量" : ` / ${maxNominations} 条`}</span>
          <span className="text-muted-foreground">本次准备 {pending.length} 条{remaining === null ? "" : ` · 剩余 ${remaining} 个名额`}</span>
        </div>
        <div className="space-y-2">
          <Label htmlFor="batch-nominator-name">提名者（本次统一使用）</Label>
          <Input id="batch-nominator-name" value={nominatorDisplayName} maxLength={120}
            disabled={!ready || isSubmitting} placeholder="用于公开展示的提名者名称，可不填"
            onChange={(event) => setNominatorDisplayName(event.currentTarget.value)} />
        </div>
      </div>

      {restoredCount > 0 ? <p className="text-sm text-muted-foreground" role="status">已恢复 {restoredCount} 条草稿，包括已上传的图片。</p> : null}
      {nominationCountError ? <p role="alert" className="text-sm text-destructive">{nominationCountError}</p> : null}
      {!ready ? <p className="text-sm text-muted-foreground">正在读取草稿...</p> : null}

      <div className="space-y-4">
        {entries.map((entry, index) => {
          const submitted = entry.state === "success";
          const publicImageUrl = getPublicImageUrl(entry.image?.imagePath);
          const imageUrl = publicImageUrl && entry.image?.imageVersion
            ? `${publicImageUrl}?v=${entry.image.imageVersion}` : publicImageUrl;
          const duplicateInBatch = entry.name.trim() && entries.some((other) => other.id !== entry.id && normalizeSearch(other.name) === normalizeSearch(entry.name));
          return (
            <section key={entry.id} className="overflow-hidden rounded-2xl border border-[#EED8AA]/80 bg-[#FFFCF4]/90" aria-label={`提名 ${index + 1}`}>
              <div className="flex items-center gap-2 p-3 sm:p-4">
                <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  disabled={submitted || isSubmitting || busyImages.has(entry.id)} aria-expanded={entry.expanded}
                  aria-controls={`nomination-fields-${entry.id}`}
                  onClick={() => updateEntry(entry.id, { expanded: !entry.expanded })}>
                  {submitted ? <CheckCircle2 className="size-5 shrink-0 text-green-700" /> : entry.expanded ? <ChevronDown className="size-5 shrink-0" /> : <ChevronRight className="size-5 shrink-0" />}
                  {imageUrl && !entry.expanded ? <Image src={imageUrl} alt="" width={40} height={40} unoptimized className="size-10 shrink-0 rounded-lg object-cover" /> : null}
                  <span className="min-w-0 flex-1 break-words font-medium">{entry.name || `提名 ${index + 1}`}</span>
                  <Badge variant="secondary" className="shrink-0">{submitted ? nominationStatusLabel[entry.submittedStatus ?? "pending"] : entry.state === "submitting" ? "提交中" : entry.state === "error" ? "待处理" : hasNominationDraftContent(entry) && !getNominationDraftError(entry, requiresImage, descriptionMaxLength) ? "已填完整" : "草稿"}</Badge>
                </button>
                {!submitted ? <Button type="button" variant="ghost" size="icon" aria-label={`移除提名 ${index + 1}`}
                  disabled={isSubmitting || busyImages.has(entry.id)}
                  onClick={() => setEntries((current) => current.filter((item) => item.id !== entry.id))}>
                  <Trash2 className="size-4" />
                </Button> : null}
              </div>
              {!submitted ? (
                <div id={`nomination-fields-${entry.id}`} hidden={!entry.expanded} className="border-t border-[#EED8AA]/70 p-4">
                  <div className="grid gap-5 sm:grid-cols-[148px_minmax(0,1fr)]">
                    <div className="w-full max-w-[180px] space-y-2">
                      <Label className="inline-flex items-center gap-2"><ImagePlus className="size-4" />图片{requiresImage ? "（必填）" : "（选填）"}</Label>
                      <ImageCropUpload mode="candidate-image" storagePath={nominationDraftImagePath(userId, entry.id)}
                        value={entry.image ?? undefined} disabled={isSubmitting}
                        onBusyChange={(busy) => setImageBusy(entry.id, busy)}
                        onUploaded={(result) => updateEntry(entry.id, { image: {
                          imagePath: result.imagePath, imageWidth: result.imageWidth,
                          imageHeight: result.imageHeight, imageSize: result.imageSize,
                          imageVersion: Date.now(),
                        }, error: null, state: "editing" })} />
                    </div>
                    <div className="min-w-0 space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor={`nomination-name-${entry.id}`}>候选项名称</Label>
                        <div className="relative">
                          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                          <Input id={`nomination-name-${entry.id}`} value={entry.name} maxLength={120} disabled={isSubmitting}
                            aria-invalid={entry.error ? true : undefined} placeholder="候选项名称" className="pl-9"
                            onChange={(event) => updateEntry(entry.id, { name: event.currentTarget.value, state: "editing", error: null })} />
                        </div>
                        {duplicateInBatch ? <p className="text-sm text-amber-800">本批中有相同名称，请确认是否重复。</p> : null}
                        <DuplicateNominationHint candidateName={entry.name} nominations={existingNominations} showNominatorInfo={showNominatorInfo} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`nomination-description-${entry.id}`}>候选项简介</Label>
                        <DescriptionTextarea id={`nomination-description-${entry.id}`} value={entry.description}
                          maxLength={descriptionMaxLength} disabled={isSubmitting} placeholder="简单介绍这个候选项。"
                          onChange={(event) => updateEntry(entry.id, { description: event.currentTarget.value, state: "editing", error: null })} />
                      </div>
                    </div>
                  </div>
                  {entry.error ? <p role="alert" className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{entry.error}</p> : null}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      <Button type="button" variant="outline" className="w-full border-dashed" disabled={!ready || isSubmitting || !canAdd || Boolean(nominationCountError)} onClick={addEntry}>
        <Plus className="size-4" />{remaining === 0 ? "提名名额已用完" : "再加一个"}
      </Button>

      <div className="sticky bottom-[calc(var(--site-bottom-nav-height)+env(safe-area-inset-bottom,0px)+0.5rem)] z-20 space-y-3 rounded-2xl border border-[#EED8AA] bg-[#FFFCF4] p-4 shadow-sm lg:bottom-4">
        {message ? <p role="status" className="break-words text-sm">{message}</p> : null}
        {overLimit ? <p role="alert" className="text-sm text-destructive">本次数量超过剩余名额，请移除部分草稿。草稿会继续保留。</p> : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className={`text-xs leading-5 ${saveError ? "text-destructive" : "text-muted-foreground"}`} role="status">
            {saveError ? "此浏览器暂时无法保存草稿，请保持本页打开。" : null}
          </p>
          <LoadingButton type="submit" variant="nomination" className="w-full sm:w-auto" loading={isSubmitting} loadingText="正在逐条提交..."
            disabled={!ready || isSubmitting || !pending.length || busyImages.size > 0 || overLimit || Boolean(nominationCountError)}>
            {busyImages.size > 0 ? "请先完成图片上传" : pending.length ? `提交这 ${pending.length} 个提名` : "提交提名"}
          </LoadingButton>
        </div>
      </div>
    </form>
  );
}
