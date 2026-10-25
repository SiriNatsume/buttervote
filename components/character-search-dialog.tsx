"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { CharacterSearchResultCard } from "@/components/character-search-result-card";
import { toUserFacingError } from "@/lib/action-error";
import { searchCharacterImages } from "@/lib/character-search/client-search";
import {
  CHARACTER_SOURCES,
  CHARACTER_SOURCE_LABELS,
  type CharacterSearchItem,
  type CharacterSearchResponse,
  type CharacterSearchSource,
} from "@/lib/character-search/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function CharacterSearchDialog({
  onClose, initialQuery = "", onSelect,
}: {
  onClose: () => void;
  initialQuery?: string;
  onSelect: (item: CharacterSearchItem) => Promise<void>;
}) {
  const inputId = useId();
  const [query, setQuery] = useState(initialQuery.slice(0, 100));
  const [source, setSource] = useState<CharacterSearchSource>("all");
  const [result, setResult] = useState<CharacterSearchResponse | null>(null);
  const [page, setPage] = useState(0);
  const [lastQuery, setLastQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [selecting, setSelecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const requestKeyRef = useRef<string | null>(null);
  useEffect(() => () => {
    requestRef.current?.abort();
    requestRef.current = null;
    requestKeyRef.current = null;
  }, []);

  async function search(nextPage = 1, nextSource = source) {
    const keyword = (nextPage > 1 ? lastQuery : query).trim();
    if (!keyword) { setError("请输入角色名。"); return; }
    const key = JSON.stringify([keyword, nextSource, nextPage]);
    if (requestKeyRef.current === key && requestRef.current && !requestRef.current.signal.aborted) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    requestKeyRef.current = key;
    const timeout = setTimeout(() => controller.abort(), 20000);
    setLoading(true);
    setError(null);
    if (nextPage === 1) setResult(null);
    try {
      const data = await searchCharacterImages(keyword, nextSource, nextPage, controller.signal);
      if (controller.signal.aborted) return;
      setResult((previous) => {
        if (nextPage === 1 || !previous) return data;
        const seen = new Set(previous.items.map((item) => `${item.source}:${item.id}`));
        return { ...data, items: [...previous.items, ...data.items.filter((item) => !seen.has(`${item.source}:${item.id}`))] };
      });
      setPage(nextPage);
      setLastQuery(keyword);
    } catch (cause) {
      if (requestRef.current === controller) setError(controller.signal.aborted
        ? "搜索超时，请稍后重试。"
        : toUserFacingError(cause instanceof Error ? cause.message : undefined));
    } finally {
      clearTimeout(timeout);
      if (requestRef.current === controller) {
        requestRef.current = null;
        requestKeyRef.current = null;
        setLoading(false);
      }
    }
  }

  async function select(item: CharacterSearchItem) {
    if (selecting) return;
    setSelecting(`${item.source}:${item.id}`);
    setError(null);
    try {
      await onSelect(item);
      onClose();
    } catch (cause) {
      setError(toUserFacingError(cause instanceof Error ? cause.message : "角色图片加载失败，请稍后重试。"));
    } finally {
      setSelecting(null);
    }
  }

  return (
    <Dialog open onOpenChange={(nextOpen) => { if (!nextOpen && !selecting) onClose(); }}>
      <DialogContent className="max-w-3xl" onCloseAutoFocus={(event) => { if (selecting) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>搜索角色图片</DialogTitle>
          <DialogDescription>搜索角色名，选择图片后裁剪使用。</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Label htmlFor={inputId}>角色名</Label>
          <div className="flex gap-2">
            <Input id={inputId} value={query} maxLength={100} autoComplete="off" autoCorrect="off" spellCheck={false} placeholder="输入中文、日文或罗马音"
              disabled={Boolean(selecting)}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  if (!selecting) void search();
                }
              }} />
            <Button type="button" disabled={loading || Boolean(selecting)} onClick={() => void search()}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
              搜索
            </Button>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="搜索来源">
            {(["all", ...CHARACTER_SOURCES] as const).map((value) => (
              <Button key={value} type="button" size="sm" variant={source === value ? "default" : "outline"}
                aria-pressed={source === value} disabled={Boolean(selecting)}
                onClick={() => {
                  setSource(value);
                  if (query.trim()) void search(1, value);
                  else { requestRef.current?.abort(); requestRef.current = null; requestKeyRef.current = null; setResult(null); setLoading(false); }
                }}>
                {value === "all" ? "全部来源" : CHARACTER_SOURCE_LABELS[value]}
              </Button>
            ))}
          </div>
          <p className="text-xs leading-5 text-muted-foreground">中文名自动同时搜索简体和繁体；AniList、VNDB 也可尝试日文名或罗马音。</p>
        </div>

        <div aria-live="polite" aria-busy={loading || Boolean(selecting)} className="space-y-3">
          {error ? <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p> : null}
          {result?.errors.map((failure) => <p key={failure.source} className="text-sm text-amber-800">{CHARACTER_SOURCE_LABELS[failure.source]}：{failure.message}</p>)}
          {selecting ? <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" />正在载入角色图片…</p> : null}
          {loading && !result?.items.length ? <p role="status" className="py-8 text-center text-sm text-muted-foreground">正在搜索角色…</p> : null}
          {!loading && !error && !result ? <p className="py-8 text-center text-sm text-muted-foreground">输入角色名开始搜索。</p> : null}
          {result && !loading && !result.items.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{result.errors.length ? "暂无可用结果，可以切换来源或稍后重试。" : "没有找到带图片的角色，试试其他名字或切换来源。"}也可以返回后上传本地图片。</p>
          ) : null}
          {result?.items.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {result.items.map((item) => <CharacterSearchResultCard
                key={`${item.source}:${item.id}:${item.thumbnailUrl}:${item.imageUrl}`}
                item={item} disabled={Boolean(selecting) || loading} onSelect={(item) => void select(item)} />)}
            </div>
          ) : null}
          {result?.hasMore && page < 20 ? <Button type="button" variant="outline" className="w-full"
            disabled={loading || Boolean(selecting)} onClick={() => void search(page + 1)}>
            {loading ? "正在加载…" : "加载更多"}
          </Button> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
