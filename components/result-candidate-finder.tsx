"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { VoteCandidateThumb } from "@/components/vote-candidate-thumb";
import type { ResultSearchItem } from "@/lib/result-search";

function normalizeName(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("zh-CN");
}

export function ResultCandidateFinder({ items, showImage, scoreLabel }: {
  items: ResultSearchItem[];
  showImage: boolean;
  scoreLabel: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const finder = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const currentRow = useRef<HTMLElement | null>(null);
  const menuId = useId();
  const term = normalizeName(query);
  const visible = open && term.length > 0;
  const matches = visible ? items.filter((item) => normalizeName(item.name).includes(term)) : [];

  useEffect(() => {
    if (!visible) return;
    function dismissOutside(event: PointerEvent) {
      if (event.target instanceof Node && !finder.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, [visible]);

  function locate(item: ResultSearchItem) {
    const target = document.getElementById(item.rowId);
    if (!target) return;
    currentRow.current?.removeAttribute("aria-current");
    target.setAttribute("aria-current", "true");
    currentRow.current = target;
    setQuery("");
    setOpen(false);
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "center", behavior: "instant" });
  }

  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    if (!visible || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === "Escape") {
      event.preventDefault();
      input.current?.focus();
      setOpen(false);
    } else if (event.key === "Enter" && event.target === input.current && matches.length === 1) {
      event.preventDefault();
      locate(matches[0]);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const buttons = Array.from(menu.current?.querySelectorAll("button") ?? []);
      if (!buttons.length) return;
      const index = buttons.findIndex((button) => button === event.target);
      event.preventDefault();
      if (event.key === "ArrowDown") buttons[Math.min(index + 1, buttons.length - 1)].focus();
      else (buttons[index - 1] ?? input.current)?.focus();
    }
  }

  return (
    <div
      ref={finder}
      role="search" aria-label="本场排名"
      className="sticky top-[var(--site-header-height)] z-20 bg-[#FFFAEF] py-2"
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={handleKey}
    >
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={input}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          aria-label="在本场榜单中查找名字"
          aria-controls={visible ? menuId : undefined}
          autoComplete="off"
          placeholder={`在本场 ${items.length} 个候选项中查找名字`}
          className="h-12 pl-9 pr-14"
        />
        {query && (
          <button
            type="button" aria-label="清空搜索"
            className="absolute inset-y-0 right-1 min-w-11 rounded-lg text-sm text-[#834322] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => {
              setQuery("");
              input.current?.focus();
            }}
          >
            清空
          </button>
        )}
      </div>
      <p role="status" className="sr-only">{visible ? `匹配到 ${matches.length} 个候选项` : ""}</p>
      {visible && (
        <div className="absolute inset-x-0 top-[calc(100%-4px)] rounded-xl border border-[#D9BE91] bg-[#FFFCF4] p-1 shadow-lg">
          <ul id={menuId} ref={menu} aria-label="匹配的候选项" className="max-h-[min(17rem,35dvh)] overflow-y-auto overscroll-contain">
            {matches.map((item) => {
              const rankLabel = `${item.tied ? "并列" : ""}第 ${item.rank} 名`;
              return (
                <li key={item.rowId}>
                  <button
                    type="button"
                    onClick={() => locate(item)}
                    aria-label={`定位${item.name}，${rankLabel}，${scoreLabel} ${item.score} 分`}
                    className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-[#FFF2D7] focus-visible:bg-[#FFF2D7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <VoteCandidateThumb candidate={item} show={showImage} compact />
                    <span className="min-w-0 flex-1 break-words font-medium">{item.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{rankLabel}</span>
                    <span className="shrink-0 font-semibold tabular-nums">{item.score} 分</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {matches.length === 0 && <p className="p-3 text-sm text-muted-foreground">本场没有匹配项，可以试试名字中的一两个字。</p>}
        </div>
      )}
    </div>
  );
}
