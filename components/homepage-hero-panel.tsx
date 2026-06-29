"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type HomepageHeroPanelProps = {
  title: string;
  description: string;
  href: string;
  cta: string;
  showDescription: boolean;
  imageUrl: string | null;
};

type HeroTextTone = "dark" | "light";

function getAverageLuminance(imageData: ImageData) {
  const data = imageData.data;
  let total = 0;
  let count = 0;

  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3] / 255;
    if (alpha <= 0) {
      continue;
    }

    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    total += (0.2126 * red + 0.7152 * green + 0.0722 * blue) * alpha;
    count += alpha;
  }

  return count > 0 ? total / count : 255;
}

async function waitForImage(image: HTMLImageElement) {
  if (image.complete) {
    if (image.naturalWidth > 0) {
      return;
    }

    throw new Error("Hero image failed to load.");
  }

  if (typeof image.decode === "function") {
    await image.decode();
    if (image.naturalWidth > 0) {
      return;
    }

    throw new Error("Hero image failed to decode.");
  }

  await new Promise<void>((resolve, reject) => {
    image.addEventListener("load", () => resolve(), { once: true });
    image.addEventListener("error", () => reject(new Error("Hero image failed to load.")), {
      once: true,
    });
  });

  if (image.naturalWidth <= 0) {
    throw new Error("Hero image failed to load.");
  }
}

function getSampleRect(panel: DOMRect, image: DOMRect) {
  const left = Math.max(panel.left, image.left);
  const top = Math.max(panel.top, image.top);
  const right = Math.min(panel.right, image.right);
  const bottom = Math.min(panel.bottom, image.bottom);

  if (right > left && bottom > top) {
    return { left, top, right, bottom };
  }

  const centerX = panel.left + panel.width / 2;
  const centerY = panel.top + panel.height / 2;
  const size = 96;

  return {
    left: Math.min(Math.max(centerX - size / 2, image.left), image.right),
    top: Math.min(Math.max(centerY - size / 2, image.top), image.bottom),
    right: Math.min(Math.max(centerX + size / 2, image.left), image.right),
    bottom: Math.min(Math.max(centerY + size / 2, image.top), image.bottom),
  };
}

export function HomepageHeroPanel({
  title,
  description,
  href,
  cta,
  showDescription,
  imageUrl,
}: HomepageHeroPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [tone, setTone] = useState<HeroTextTone>("dark");

  useEffect(() => {
    if (!imageUrl) {
      setTone("dark");
      return;
    }

    let cancelled = false;

    async function updateTone() {
      const panel = panelRef.current;
      const heroImage = document.querySelector<HTMLImageElement>(
        "[data-homepage-hero-image='true']",
      );

      if (!panel || !heroImage || window.innerWidth < 640) {
        setTone("dark");
        return;
      }

      try {
        await waitForImage(heroImage);

        if (cancelled || heroImage.naturalWidth <= 0 || heroImage.naturalHeight <= 0) {
          return;
        }

        const panelRect = panel.getBoundingClientRect();
        const imageRect = heroImage.getBoundingClientRect();
        if (imageRect.width <= 0 || imageRect.height <= 0) {
          setTone("dark");
          return;
        }

        const sampleSource = heroImage.currentSrc || imageUrl;
        if (!sampleSource) {
          setTone("dark");
          return;
        }

        const sampleImage = new window.Image();
        sampleImage.crossOrigin = "anonymous";
        sampleImage.src = sampleSource;
        await waitForImage(sampleImage);

        if (
          cancelled ||
          sampleImage.naturalWidth <= 0 ||
          sampleImage.naturalHeight <= 0
        ) {
          return;
        }

        const sampleRect = getSampleRect(panelRect, imageRect);
        const sourceX =
          ((sampleRect.left - imageRect.left) / imageRect.width) *
          sampleImage.naturalWidth;
        const sourceY =
          ((sampleRect.top - imageRect.top) / imageRect.height) *
          sampleImage.naturalHeight;
        const sourceWidth =
          ((sampleRect.right - sampleRect.left) / imageRect.width) *
          sampleImage.naturalWidth;
        const sourceHeight =
          ((sampleRect.bottom - sampleRect.top) / imageRect.height) *
          sampleImage.naturalHeight;

        if (sourceWidth <= 0 || sourceHeight <= 0) {
          setTone("dark");
          return;
        }

        const canvas = document.createElement("canvas");
        canvas.width = 24;
        canvas.height = 24;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) {
          setTone("dark");
          return;
        }

        context.drawImage(
          sampleImage,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          0,
          0,
          canvas.width,
          canvas.height,
        );

        const luminance = getAverageLuminance(
          context.getImageData(0, 0, canvas.width, canvas.height),
        );
        setTone(luminance < 135 ? "light" : "dark");
      } catch {
        setTone("dark");
      }
    }

    updateTone();
    window.addEventListener("resize", updateTone);

    return () => {
      cancelled = true;
      window.removeEventListener("resize", updateTone);
    };
  }, [imageUrl]);

  const useLightText = tone === "light";

  return (
    <div
      ref={panelRef}
      className={cn(
        "relative z-10 border-t border-[#EED8AA]/70 bg-[#FFF8E8]/97 p-3 transition-colors duration-300",
        showDescription
          ? "sm:absolute sm:bottom-5 sm:left-5 sm:max-w-[420px] sm:rounded-2xl sm:border sm:p-4 sm:shadow-sm sm:backdrop-blur-md lg:bottom-8 lg:left-8 lg:max-w-[460px]"
          : "sm:absolute sm:inset-x-5 sm:bottom-5 sm:rounded-2xl sm:border sm:px-4 sm:py-3 sm:shadow-sm sm:backdrop-blur-md lg:inset-x-8 lg:bottom-8",
        useLightText
          ? "sm:border-white/20 sm:bg-[#2B1A10]/72"
          : "sm:border-[#EED8AA]/70 sm:bg-[#FFF8E8]/88",
      )}
    >
      <div
        className={
          showDescription
            ? "flex flex-col gap-2.5"
            : "flex items-center justify-between gap-3"
        }
      >
        <h1
          className={cn(
            "tracking-normal transition-colors duration-300",
            showDescription
              ? "max-w-full break-words text-2xl font-bold sm:text-3xl"
              : "min-w-0 flex-1 truncate text-xl font-bold sm:text-2xl",
            useLightText ? "text-[#5C321E] sm:text-white" : "text-[#5C321E]",
          )}
        >
          {title}
        </h1>
        {showDescription ? (
          <p
            className={cn(
              "line-clamp-2 max-w-2xl text-sm leading-6 transition-colors duration-300",
              useLightText ? "text-[#6A4A2B] sm:text-white/88" : "text-[#6A4A2B]",
            )}
          >
            {description}
          </p>
        ) : null}
        <Button asChild size="sm" className="w-fit">
          <Link href={href}>
            {cta}
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
