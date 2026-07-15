"use client";

import {
  type CSSProperties,
  type MouseEvent,
  type UIEvent,
  type WheelEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ImageIcon,
} from "lucide-react";
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
  thumbnailUrl: string;
};

export function HallOfFameGallery({
  items,
  errorMessage,
}: {
  items: HallOfFameGalleryItem[];
  errorMessage?: string | null;
}) {
  const [selected, setSelected] = useState<HallOfFameGalleryItem | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loadedOriginalIds, setLoadedOriginalIds] = useState<Set<string>>(
    () => new Set(),
  );
  const trackRef = useRef<HTMLDivElement>(null);
  const wheelLockedRef = useRef(false);

  const activeItem = items[activeIndex];
  const previousItem = items[activeIndex - 1];
  const nextItem = items[activeIndex + 1];
  useEffect(() => {
    if (!activeItem || loadedOriginalIds.has(activeItem.id)) return;

    let cancelled = false;
    const image = new Image();
    image.decoding = "async";
    image.addEventListener("load", () => {
      if (cancelled) return;
      setLoadedOriginalIds((current) => {
        if (current.has(activeItem.id)) return current;
        const next = new Set(current);
        next.add(activeItem.id);
        return next;
      });
    });
    image.src = activeItem.posterUrl;

    return () => {
      cancelled = true;
    };
  }, [activeItem, loadedOriginalIds]);

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

  if (errorMessage) {
    return (
      <div className="flex min-h-72 flex-col items-center justify-center rounded-3xl border border-destructive/30 bg-destructive/5 px-6 text-center">
        <CircleAlert className="mb-4 size-10 text-destructive" aria-hidden="true" />
        <h2 className="text-xl font-semibold text-[#5C321E]">冠军英灵殿加载失败</h2>
        <p className="mt-2 text-sm text-muted-foreground">{errorMessage}</p>
      </div>
    );
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
        <div className="relative lg:px-16">
          {items.length > 1 ? (
            <button
              type="button"
              aria-controls="hall-of-fame-track"
              aria-label={
                previousItem
                  ? `查看上一位冠军：${previousItem.winnerName}`
                  : "已经是第一位冠军"
              }
              title={
                previousItem
                  ? `上一位：${previousItem.winnerName}`
                  : "已经是第一位冠军"
              }
              disabled={!previousItem}
              onClick={() => centerCard(activeIndex - 1)}
              className="absolute left-2 top-1/2 z-10 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full border border-[#E3C98F] bg-[#FFFCF4]/95 text-[#7A4A28] shadow-sm backdrop-blur-sm transition hover:scale-105 hover:border-[#C99A54] hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:scale-100 lg:flex"
            >
              <ChevronLeft className="size-6" aria-hidden="true" />
            </button>
          ) : null}
          <div
            id="hall-of-fame-track"
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
                    src={
                      loadedOriginalIds.has(item.id)
                        ? item.posterUrl
                        : item.thumbnailUrl
                    }
                    alt={`${item.eventTitle}胜者海报`}
                    loading={index === activeIndex ? "eager" : "lazy"}
                    decoding="async"
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
          {items.length > 1 ? (
            <button
              type="button"
              aria-controls="hall-of-fame-track"
              aria-label={
                nextItem
                  ? `查看下一位冠军：${nextItem.winnerName}`
                  : "已经是最后一位冠军"
              }
              title={
                nextItem
                  ? `下一位：${nextItem.winnerName}`
                  : "已经是最后一位冠军"
              }
              disabled={!nextItem}
              onClick={() => centerCard(activeIndex + 1)}
              className="absolute right-2 top-1/2 z-10 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full border border-[#E3C98F] bg-[#FFFCF4]/95 text-[#7A4A28] shadow-sm backdrop-blur-sm transition hover:scale-105 hover:border-[#C99A54] hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:scale-100 lg:flex"
            >
              <ChevronRight className="size-6" aria-hidden="true" />
            </button>
          ) : null}
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
              decoding="async"
              className="max-h-full max-w-full object-contain"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
