"use client";

import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

export function HomepageBackToTop({
  showOnDesktop = false,
  focusTarget = ".homepage-main",
}: {
  showOnDesktop?: boolean;
  focusTarget?: string;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const updateVisibility = () => setVisible(window.scrollY > 320);
    updateVisibility();
    window.addEventListener("scroll", updateVisibility, { passive: true });
    return () => window.removeEventListener("scroll", updateVisibility);
  }, []);

  if (!visible) return null;

  function scrollToTop() {
    document.querySelector<HTMLElement>(focusTarget)?.focus({ preventScroll: true });
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }

  return (
    <button
      type="button"
      aria-label="回到顶部"
      title="回到顶部"
      onClick={scrollToTop}
      className={cn(
        "fixed bottom-[calc(var(--site-bottom-nav-height)+1.25rem+env(safe-area-inset-bottom,0px))] right-4 z-30 flex size-12 items-center justify-center rounded-full border border-[#DFC28E] bg-[#FFF8E8]/95 text-[#6A3E21] shadow-lg shadow-[#5C321E]/10 backdrop-blur-sm transition-colors hover:bg-[#FFF3D0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-2 motion-reduce:transition-none",
        showOnDesktop ? "lg:bottom-6" : "lg:hidden",
      )}
    >
      <ArrowUp className="size-5" aria-hidden="true" />
    </button>
  );
}
