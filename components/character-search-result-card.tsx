"use client";

import { useState } from "react";
import { ExternalLink, UserRound } from "lucide-react";
import { CHARACTER_SOURCE_LABELS, type CharacterSearchItem } from "@/lib/character-search/types";
import { characterThumbnailUrl } from "@/lib/character-search/thumbnail-url";

export function CharacterSearchResultCard({ item, disabled, onSelect }: {
  item: CharacterSearchItem; disabled: boolean; onSelect: (item: CharacterSearchItem) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const sources = [...new Set([
    characterThumbnailUrl(item.source, item.thumbnailUrl),
    characterThumbnailUrl(item.source, item.imageUrl),
    item.thumbnailUrl,
  ])];
  const failed = attempt >= sources.length;
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-[#EED8AA]/80 bg-white/70">
      <button type="button" className="flex w-full flex-1 flex-col text-left transition hover:bg-[#FFF3D0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50"
        aria-label={`选择 ${item.name}（${CHARACTER_SOURCE_LABELS[item.source]}）`} disabled={disabled} onClick={() => onSelect(item)}>
        <div className="relative flex aspect-square w-full shrink-0 items-center justify-center overflow-hidden bg-[#FFF8E8]">
          {!loaded ? <UserRound className="absolute size-8 text-muted-foreground/40" aria-hidden="true" /> : null}
          {!failed ? (
            // Public catalogue previews use a bounded, shared-cache proxy.
            // eslint-disable-next-line @next/next/no-img-element
            <img key={sources[attempt]} src={sources[attempt]} alt={item.name} loading="lazy" decoding="async" referrerPolicy="no-referrer"
              className="relative size-full object-contain" onLoad={() => setLoaded(true)}
              onError={() => { setLoaded(false); setAttempt((value) => value + 1); }} />
          ) : <span className="absolute bottom-2 text-xs text-muted-foreground">预览暂不可用</span>}
        </div>
        <div className="space-y-1 p-3">
          <p className="break-words text-sm font-medium">{item.name}</p>
          {item.originalName !== item.name ? <p className="line-clamp-1 break-words text-xs text-muted-foreground">{item.originalName}</p> : null}
          {item.works.length ? <p className="line-clamp-2 break-words text-xs leading-5 text-muted-foreground">{item.works.join(" / ")}</p> : null}
        </div>
      </button>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#EED8AA]/50 px-3 py-2">
        <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          aria-label={`在 ${CHARACTER_SOURCE_LABELS[item.source]} 查看 ${item.name}`}>
          {CHARACTER_SOURCE_LABELS[item.source]}<ExternalLink className="size-3" />
        </a>
        {failed ? <button type="button" className="text-xs text-orange-700 hover:underline" disabled={disabled}
          onClick={() => { setAttempt(0); setLoaded(false); }}>重试预览</button> : null}
      </div>
    </div>
  );
}
