"use client";

import {
  type CSSProperties,
  type MouseEvent,
  type UIEvent,
  type WheelEvent,
  useRef,
  useState,
} from "react";
import { ImageIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";

export type HallOfFameGalleryItem = {
  id: string;
  eventTitle: string;
  winnerName: string;
  description: string;
  posterUrl: string;
};

export function HallOfFameGallery({ items }: { items: HallOfFameGalleryItem[] }) {
  const [selected, setSelected] = useState<HallOfFameGalleryItem | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const wheelLockedRef = useRef(false);

  function centerCard(index: number) {
    const track = trackRef.current;
    const target = track?.querySelector<HTMLElement>(
      `[data-gallery-index="${index}"]`,
    );
    if (!track || !target) return;

    setActiveIndex(index);
    track.scrollTo({
      left: target.offsetLeft + target.offsetWidth / 2 - track.clientWidth / 2,
      behavior: "smooth",
    });
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    const track = event.currentTarget;
    if (track.scrollWidth <= track.clientWidth) return;

    const delta =
      Math.abs(event.deltaY) >= Math.abs(event.deltaX)
        ? event.deltaY
        : event.deltaX;
    const direction = delta < 0 ? -1 : 1;
    const nextIndex = Math.max(0, Math.min(items.length - 1, activeIndex + direction));
    if (nextIndex === activeIndex) return;

    event.preventDefault();
    if (wheelLockedRef.current) return;

    wheelLockedRef.current = true;
    centerCard(nextIndex);
    window.setTimeout(() => {
      wheelLockedRef.current = false;
    }, 420);
  }

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const track = event.currentTarget;
    const center = track.scrollLeft + track.clientWidth / 2;
    let nearestIndex = activeIndex;
    let nearestDistance = Number.POSITIVE_INFINITY;

    track.querySelectorAll<HTMLElement>("[data-gallery-index]").forEach((card) => {
      const distance = Math.abs(card.offsetLeft + card.offsetWidth / 2 - center);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = Number(card.dataset.galleryIndex ?? 0);
      }
    });
    if (nearestIndex !== activeIndex) setActiveIndex(nearestIndex);
  }

  function handleCardClick(
    event: MouseEvent<HTMLButtonElement>,
    item: HallOfFameGalleryItem,
    index: number,
  ) {
    if (index !== activeIndex) {
      const card = event.currentTarget;
      if (card.parentElement) centerCard(index);
      return;
    }

    setSelected(item);
  }

  if (items.length === 0) {
    return (
      <div className="flex min-h-72 flex-col items-center justify-center rounded-3xl border border-dashed border-[#E3C98F] bg-[#FFF8E8]/70 px-6 text-center">
        <ImageIcon className="mb-4 size-10 text-[#C99A54]" aria-hidden="true" />
        <h2 className="text-xl font-semibold text-[#5C321E]">冠军英灵殿正在准备中</h2>
        <p className="mt-2 text-sm text-muted-foreground">历届胜者海报将在这里依次展出。</p>
      </div>
    );
  }

  return (
    <>
      <div className="relative">
        <div
          ref={trackRef}
          onWheel={handleWheel}
          onScroll={handleScroll}
          className="flex snap-x snap-mandatory gap-2 overflow-x-auto scroll-smooth pb-7 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:gap-4"
          style={{
            "--hall-card-width": "min(78vw, 310px)",
            paddingInline: "calc((100% - var(--hall-card-width)) / 2)",
            maskImage:
              "linear-gradient(to right, transparent 0, black 4%, black 96%, transparent 100%)",
            WebkitMaskImage:
              "linear-gradient(to right, transparent 0, black 4%, black 96%, transparent 100%)",
          } as CSSProperties}
        >
          {items.map((item, index) => (
            <button
              key={item.id}
              data-gallery-index={index}
              type="button"
              onClick={(event) => handleCardClick(event, item, index)}
              className={`group w-[var(--hall-card-width)] shrink-0 snap-center overflow-hidden rounded-[1.35rem] border border-[#EED8AA]/70 bg-[#FFFCF4] p-3 text-left shadow-sm transition-[transform,opacity,box-shadow,border-color] duration-300 hover:border-orange-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                index === activeIndex
                  ? "scale-100 opacity-100 shadow-md"
                  : "scale-90 opacity-60 hover:opacity-80"
              }`}
            >
              <div className="aspect-[3/4] overflow-hidden rounded-xl bg-[#F6E9CE]">
                <img
                  src={item.posterUrl}
                  alt={`${item.eventTitle}胜者海报`}
                  className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
                />
              </div>
              <div className="px-1 pb-1 pt-3 text-center">
                <div className="truncate text-xs text-muted-foreground">{item.eventTitle}</div>
                <div className="mt-1 truncate text-xl font-semibold text-[#5C321E]">{item.winnerName}</div>
                <div className="mt-1 truncate text-xs text-muted-foreground">{item.description || "\u00a0"}</div>
              </div>
            </button>
          ))}
        </div>
        <div
          className="mx-auto flex max-w-full items-center justify-center overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          aria-label="冠军英灵殿轮播位置"
        >
          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              aria-label={`转到第 ${index + 1} 张海报`}
              aria-current={index === activeIndex ? "true" : undefined}
              onClick={() => centerCard(index)}
              className="group flex size-4 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span
                className={`block rounded-full transition-all duration-200 ${
                  index === activeIndex
                    ? "size-2 bg-[#B7792C]"
                    : "size-1.5 bg-[#D8C29A] group-hover:bg-[#C99A54]"
                }`}
              />
            </button>
          ))}
        </div>
      </div>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent
          aria-describedby={undefined}
          className="flex h-[calc(100dvh-2rem)] max-w-6xl items-center justify-center overflow-hidden border-0 bg-[#666666]/95 p-3 sm:p-5"
        >
          <DialogTitle className="sr-only">查看海报大图</DialogTitle>
          {selected ? (
            <img
              src={selected.posterUrl}
              alt={`${selected.eventTitle}胜者海报`}
              className="max-h-full max-w-full object-contain"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
