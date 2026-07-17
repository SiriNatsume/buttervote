"use client";

import { useEffect, useState } from "react";
import type { MarkdownHeading } from "@/lib/markdown-headings";
import { cn } from "@/lib/utils";

export function PageTableOfContents({ headings }: { headings: MarkdownHeading[] }) {
  const [activeId, setActiveId] = useState(headings[0]?.id ?? "");

  useEffect(() => {
    let frame = 0;
    const updateActiveHeading = () => {
      const threshold = 128;
      let next = headings[0]?.id ?? "";
      for (const heading of headings) {
        const element = document.getElementById(heading.id);
        if (element && element.getBoundingClientRect().top <= threshold) {
          next = heading.id;
        } else {
          break;
        }
      }
      setActiveId(next);
    };
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateActiveHeading);
    };

    updateActiveHeading();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, [headings]);

  if (headings.length === 0) return null;

  return (
    <nav aria-label="页面目录" className="max-h-[calc(100vh-8rem)] overflow-y-auto pr-3">
      <p className="mb-3 text-sm font-semibold tracking-wide text-[#4A2B1B]">目录</p>
      <ol className="border-l border-[#DFCBA5]">
        {headings.map((heading) => (
          <li key={heading.id} style={{ paddingLeft: `${(heading.depth - 1) * 0.65}rem` }}>
            <a
              href={`#${heading.id}`}
              aria-current={activeId === heading.id ? "location" : undefined}
              onClick={(event) => {
                const target = document.getElementById(heading.id);
                if (!target) return;
                event.preventDefault();
                target.scrollIntoView({
                  behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
                    ? "auto"
                    : "smooth",
                  block: "start",
                });
                window.history.pushState(null, "", `#${heading.id}`);
                setActiveId(heading.id);
              }}
              className={cn(
                "-ml-px block border-l py-1.5 pl-3 text-sm leading-5 transition-colors",
                activeId === heading.id
                  ? "border-[#C97732] font-medium text-[#8A481E]"
                  : "border-transparent text-muted-foreground hover:border-[#D8AE72] hover:text-[#4A2B1B]",
              )}
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
