"use client";

import { Fragment, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, Ellipsis } from "lucide-react";
import { useRegisterPageSection } from "@/components/page-section-provider";
import type { BreadcrumbItem, SiteSection } from "@/lib/page-navigation";
import { cn } from "@/lib/utils";

function CollapsedBreadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  const [expanded, setExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!expanded) return;
    let pointerInteraction = false;

    function beginPointerInteraction() {
      pointerInteraction = true;
    }

    function closeOutside(event: Event) {
      if (containerRef.current && event.target instanceof Node && !containerRef.current.contains(event.target)) {
        setExpanded(false);
      }
    }

    // Let a pointer click finish before collapsing the in-flow list and moving
    // the page controls underneath it. Keyboard focus can still close it early.
    function closeOnClick(event: MouseEvent) {
      closeOutside(event);
      pointerInteraction = false;
    }

    function closeOnFocus(event: FocusEvent) {
      if (!pointerInteraction) closeOutside(event);
    }

    function handleKeyDown(event: KeyboardEvent) {
      pointerInteraction = false;
      if (event.key === "Escape") {
        event.preventDefault();
        setExpanded(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", beginPointerInteraction);
    document.addEventListener("click", closeOnClick);
    document.addEventListener("focusin", closeOnFocus);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", beginPointerInteraction);
      document.removeEventListener("click", closeOnClick);
      document.removeEventListener("focusin", closeOnFocus);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [expanded]);

  return (
    <div ref={containerRef} className="relative w-11 shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label="展开折叠路径"
        aria-expanded={expanded}
        aria-controls={expanded ? listId : undefined}
        onClick={() => setExpanded((value) => !value)}
        className="flex min-h-11 min-w-11 items-center justify-center bg-transparent transition-colors hover:text-[#AE4621] focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#AE4621]"
      >
        <Ellipsis className="size-4" aria-hidden="true" />
      </button>
      {expanded ? (
        <ul
          id={listId}
          aria-label="折叠的页面路径"
          className="relative z-50 mt-1 max-h-[min(18rem,50dvh)] w-max min-w-[10rem] max-w-[calc(100vw-7rem)] overflow-y-auto overscroll-contain border-0 bg-transparent p-1 shadow-none"
        >
          {items.map((item, index) => (
            <li key={`${index}-${item.label}`}>
              {item.href ? (
                <Link
                  href={item.href}
                  onClick={() => setExpanded(false)}
                  className="block min-h-11 break-words px-3 py-2.5 text-sm text-[#49372C] underline-offset-4 transition-colors hover:text-[#AE4621] hover:underline focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#AE4621]"
                >
                  {item.label}
                </Link>
              ) : (
                <span className="block min-h-11 break-words px-3 py-2.5 text-sm text-[#49372C]">
                  {item.label}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function PageBreadcrumb({ items, section, className }: { items: BreadcrumbItem[]; section?: SiteSection; className?: string }) {
  useRegisterPageSection(section);
  if (items.length < 2) return null;
  const middle = items.slice(1, -1);
  const collapse = middle.length > 0;

  return (
    <nav aria-label="当前位置" className={cn("mb-6 min-w-0 text-[13px] leading-6 sm:mb-8 sm:text-sm", className)}>
      <ol className="flex min-w-0 flex-wrap items-start gap-x-1 text-[#88786B] sm:items-center sm:gap-x-1.5">
        {items.map((item, index) => {
          const current = index === items.length - 1;
          const intermediate = index > 0 && !current;
          return <Fragment key={`${index}-${item.label}`}>
            {collapse && index === 1 ? <li className="flex items-start gap-1 sm:hidden">
              <ChevronRight className="mt-[15px] size-3.5 shrink-0 text-[#B6A899]" aria-hidden="true" />
              <CollapsedBreadcrumbs items={middle} />
            </li> : null}
            <li className={cn("flex min-w-0 items-start gap-1 sm:gap-1.5", collapse && "pt-1 sm:pt-0", intermediate && "hidden sm:flex")}>
              {index > 0 ? <ChevronRight className="mt-[10px] size-3.5 shrink-0 text-[#B6A899] sm:mt-[7px]" aria-hidden="true" /> : null}
              {item.href && !current ? <Link
                href={item.href}
                className="min-h-9 min-w-0 break-words py-1.5 underline-offset-4 transition-colors hover:text-[#AE4621] hover:underline focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#AE4621] sm:min-h-8 sm:py-1"
              >{item.label}</Link> : <span
                aria-current={current ? "page" : undefined}
                className={cn("min-h-9 min-w-0 break-words py-1.5 sm:min-h-8 sm:py-1", current && "font-medium text-[#49372C]")}
              >{item.label}</span>}
            </li>
          </Fragment>;
        })}
      </ol>
    </nav>
  );
}
