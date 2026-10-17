"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ArrowUp } from "lucide-react";

// These desktop columns scroll independently of the document. Exclude nested
// controls such as dialogs, dropdowns and tables from the page-level action.
const PAGE_SCROLL_CONTAINERS =
  ".homepage-main, .homepage-aside, .group-overview-sidebar, .group-overview-main";

function getScrollContainers() {
  return Array.from(
    document.querySelectorAll<HTMLElement>(PAGE_SCROLL_CONTAINERS),
  );
}

export function BackToTop() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const updateVisibility = () =>
      setVisible(
        window.scrollY > 320 ||
          getScrollContainers().some((container) => container.scrollTop > 320),
      );

    updateVisibility();
    window.addEventListener("scroll", updateVisibility, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", updateVisibility);
    return () => {
      window.removeEventListener("scroll", updateVisibility, true);
      window.removeEventListener("resize", updateVisibility);
    };
  }, [pathname]);

  if (!visible) return null;

  function scrollToTop() {
    const containers = getScrollContainers().filter(
      (container) => container.scrollTop > 0,
    );
    const focusTarget =
      containers[0] ?? document.querySelector<HTMLElement>(".site-main");
    focusTarget?.focus({ preventScroll: true });

    const options: ScrollToOptions = {
      top: 0,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    };
    window.scrollTo(options);
    containers.forEach((container) => container.scrollTo(options));
  }

  return (
    <button
      type="button"
      aria-label="回到顶部"
      title="回到顶部"
      onClick={scrollToTop}
      className="fixed bottom-[calc(var(--site-bottom-nav-height)+1.25rem+env(safe-area-inset-bottom,0px))] right-4 z-30 flex size-12 items-center justify-center rounded-full border border-[#DFC28E] bg-[#FFF8E8]/95 text-[#6A3E21] shadow-lg shadow-[#5C321E]/10 backdrop-blur-sm transition-colors hover:bg-[#FFF3D0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-2 motion-reduce:transition-none lg:bottom-6"
    >
      <ArrowUp className="size-5" aria-hidden="true" />
    </button>
  );
}
