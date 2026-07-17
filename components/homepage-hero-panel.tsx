"use client";

import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";

type HomepageHeroPanelProps = {
  title: string;
  description: string;
  showDescription: boolean;
  imageUrl: string | null;
};

type RgbColor = { red: number; green: number; blue: number };

const FALLBACK_COLOR: RgbColor = { red: 255, green: 232, blue: 172 };
const DARK_TEXT: RgbColor = { red: 63, green: 36, blue: 24 };
const LIGHT_TEXT: RgbColor = { red: 255, green: 252, blue: 244 };

function mixWithWhite(color: RgbColor, whiteAmount: number): RgbColor {
  const mix = (channel: number) => Math.round(channel + (255 - channel) * whiteAmount);

  return {
    red: mix(color.red),
    green: mix(color.green),
    blue: mix(color.blue),
  };
}

function toCssColor(color: RgbColor) {
  return `rgb(${color.red} ${color.green} ${color.blue})`;
}

function relativeLuminance(color: RgbColor) {
  const linearize = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  };

  return (
    0.2126 * linearize(color.red) +
    0.7152 * linearize(color.green) +
    0.0722 * linearize(color.blue)
  );
}

function contrastRatio(first: RgbColor, second: RgbColor) {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function waitForImage(image: HTMLImageElement) {
  if (image.complete) {
    return image.naturalWidth > 0
      ? Promise.resolve()
      : Promise.reject(new Error("Hero image failed to load."));
  }

  return new Promise<void>((resolve, reject) => {
    image.addEventListener("load", () => resolve(), { once: true });
    image.addEventListener("error", () => reject(new Error("Hero image failed to load.")), {
      once: true,
    });
  });
}

function sampleImageBottom(image: HTMLImageElement): RgbColor {
  const canvas = document.createElement("canvas");
  canvas.width = 48;
  canvas.height = 8;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("Canvas is unavailable.");
  }

  const sourceHeight = Math.max(1, image.naturalHeight * 0.12);
  context.drawImage(
    image,
    0,
    image.naturalHeight - sourceHeight,
    image.naturalWidth,
    sourceHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  );

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let red = 0;
  let green = 0;
  let blue = 0;
  let weight = 0;

  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3] / 255;
    if (alpha === 0) continue;
    red += pixels[index] * alpha;
    green += pixels[index + 1] * alpha;
    blue += pixels[index + 2] * alpha;
    weight += alpha;
  }

  if (weight === 0) {
    throw new Error("Hero image has no visible bottom pixels.");
  }

  return {
    red: Math.round(red / weight),
    green: Math.round(green / weight),
    blue: Math.round(blue / weight),
  };
}

export function HomepageHeroPanel({
  title,
  description,
  showDescription,
  imageUrl,
}: HomepageHeroPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [sampledColor, setSampledColor] = useState(FALLBACK_COLOR);

  useEffect(() => {
    if (!imageUrl) {
      setSampledColor(FALLBACK_COLOR);
      return;
    }

    let cancelled = false;

    async function updateColor() {
      const hero = panelRef.current?.closest<HTMLElement>("[data-homepage-hero]");
      const image = hero?.querySelector<HTMLImageElement>(
        "[data-homepage-hero-image='true']",
      );

      if (!image) return;

      try {
        await waitForImage(image);
        const sourceUrl = image.currentSrc || imageUrl;
        if (!sourceUrl) return;
        const sampleImage = new window.Image();
        sampleImage.crossOrigin = "anonymous";
        sampleImage.src = sourceUrl;
        await waitForImage(sampleImage);
        if (!cancelled) setSampledColor(sampleImageBottom(sampleImage));
      } catch {
        if (!cancelled) setSampledColor(FALLBACK_COLOR);
      }
    }

    updateColor();
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  const edgeColor = mixWithWhite(sampledColor, 0.12);
  const baseColor = mixWithWhite(sampledColor, 0.28);
  const darkContrast = Math.min(
    contrastRatio(DARK_TEXT, edgeColor),
    contrastRatio(DARK_TEXT, baseColor),
  );
  const lightContrast = Math.min(
    contrastRatio(LIGHT_TEXT, edgeColor),
    contrastRatio(LIGHT_TEXT, baseColor),
  );
  const useLightText = lightContrast > darkContrast;
  const edgeCssColor = toCssColor(edgeColor);
  const baseCssColor = toCssColor(baseColor);
  const textCssColor = toCssColor(useLightText ? LIGHT_TEXT : DARK_TEXT);
  const gradientStyle = {
    background: `linear-gradient(180deg, ${edgeCssColor} 0%, ${baseCssColor} 100%)`,
    color: textCssColor,
  } satisfies CSSProperties;

  return (
    <div
      ref={panelRef}
      className="relative z-10 px-5 pb-5 pt-3 transition-colors duration-300 sm:px-7 sm:pb-6 sm:pt-4"
      style={gradientStyle}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-20 h-20"
        style={{
          background: `linear-gradient(180deg, transparent 0%, ${edgeCssColor} 100%)`,
        }}
      />
      <div className="relative z-[1] max-w-3xl">
        <h1
          className="break-words text-xl font-bold leading-tight tracking-normal sm:text-2xl"
          style={{ color: textCssColor }}
        >
          {title}
        </h1>
        {showDescription ? (
          <p
            className="mt-2 line-clamp-2 text-sm leading-6"
            style={{ color: textCssColor }}
          >
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}
