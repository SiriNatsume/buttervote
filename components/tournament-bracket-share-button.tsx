"use client";

import { useState, type MouseEvent } from "react";
import html2canvas from "html2canvas";
import { Download, Share2 } from "lucide-react";
import { toast } from "sonner";
import logo from "@/img/网站logo.png";
import { Button } from "@/components/ui/button";

type ShareBracket = {
  tournament: {
    name: string;
    status: string;
  };
};

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const TRANSPARENT_PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
const MAX_OUTPUT_WIDTH = 3600;
const CAPTURE_SCALE = 1.5;
const HEADER_HEIGHT = 112;
const FOOTER_HEIGHT = 112;

function imageSource(src: string | { src: string }) {
  return typeof src === "string" ? src : src.src;
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.lineTo(x + width - safeRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  ctx.lineTo(x + width, y + height - safeRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  ctx.lineTo(x + safeRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  ctx.lineTo(x, y + safeRadius);
  ctx.quadraticCurveTo(x, y, x + safeRadius, y);
  ctx.closePath();
}

function fillRoundedRect(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  radius: number,
  fill: string,
  stroke?: string,
  lineWidth = 2,
) {
  roundedRect(ctx, rect.x, rect.y, rect.width, rect.height, radius);
  ctx.fillStyle = fill;
  ctx.fill();

  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

function ellipsizeText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
) {
  if (ctx.measureText(text).width <= maxWidth) {
    return text;
  }

  let current = text;
  while (current.length > 0 && ctx.measureText(`${current}...`).width > maxWidth) {
    current = current.slice(0, -1);
  }

  return current ? `${current}...` : "...";
}

function drawImageContain(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const imageRatio = image.naturalWidth / image.naturalHeight;
  const targetRatio = width / height;
  let targetWidth = width;
  let targetHeight = height;

  if (imageRatio > targetRatio) {
    targetHeight = width / imageRatio;
  } else {
    targetWidth = height * imageRatio;
  }

  ctx.drawImage(
    image,
    x + (width - targetWidth) / 2,
    y + (height - targetHeight) / 2,
    targetWidth,
    targetHeight,
  );
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("图片读取失败。"));
    reader.readAsDataURL(blob);
  });
}

async function fetchImageAsDataUrl(src: string) {
  const response = await fetch(src, { credentials: "omit", mode: "cors" });
  if (!response.ok) {
    throw new Error("图片读取失败。");
  }

  return blobToDataUrl(await response.blob());
}

async function fetchImageAsDataUrlOrNull(src: string) {
  try {
    return await fetchImageAsDataUrl(new URL(src, window.location.href).href);
  } catch {
    return null;
  }
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

async function loadCleanImage(src: string) {
  const dataUrl = await fetchImageAsDataUrlOrNull(src);
  return dataUrl ? loadImage(dataUrl) : null;
}

async function inlineImages(root: HTMLElement) {
  const images = Array.from(root.querySelectorAll("img"));
  await Promise.all(
    images.map(async (image) => {
      const src = image.currentSrc || image.src || image.getAttribute("src");
      image.removeAttribute("srcset");
      image.removeAttribute("sizes");

      if (!src) {
        image.src = TRANSPARENT_PIXEL;
        return;
      }

      image.src = (await fetchImageAsDataUrlOrNull(src)) ?? TRANSPARENT_PIXEL;
    }),
  );
}

async function waitForImages(root: HTMLElement) {
  const images = Array.from(root.querySelectorAll("img"));
  await Promise.all(
    images.map(async (image) => {
      if (image.complete) {
        return;
      }

      if (typeof image.decode === "function") {
        await image.decode().catch(() => undefined);
        return;
      }

      await new Promise<void>((resolve) => {
        image.onload = () => resolve();
        image.onerror = () => resolve();
      });
    }),
  );
}

function expandCloneForFullBracket(clone: HTMLElement, targetWidth: number) {
  clone.style.width = `${targetWidth}px`;
  clone.style.maxWidth = "none";
  clone.style.overflow = "visible";

  for (const selector of [
    "[data-bracket-share-frame]",
    "[data-bracket-share-scroll]",
  ]) {
    for (const element of Array.from(clone.querySelectorAll<HTMLElement>(selector))) {
      element.style.width = "100%";
      element.style.maxWidth = "none";
      element.style.overflow = "visible";
      element.style.overflowX = "visible";
      element.style.overflowY = "visible";
    }
  }

  for (const element of Array.from(clone.querySelectorAll<HTMLElement>("[data-bracket-share-grid]"))) {
    element.style.maxWidth = "none";
  }

  for (const element of Array.from(clone.querySelectorAll<HTMLElement>("[data-bracket-share-control]"))) {
    element.remove();
  }
}

async function elementToCanvas(root: HTMLElement, tournamentName: string) {
  const grid = root.querySelector<HTMLElement>("[data-bracket-share-grid]");
  const rootWidth = Math.ceil(root.getBoundingClientRect().width);
  const targetWidth = Math.max(rootWidth, (grid?.scrollWidth ?? root.scrollWidth) + 48);
  const clone = root.cloneNode(true) as HTMLElement;
  clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  expandCloneForFullBracket(clone, targetWidth);

  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-100000px";
  container.style.top = "0";
  container.style.width = `${targetWidth}px`;
  container.style.background = "#FFF8E8";
  container.style.pointerEvents = "none";
  container.appendChild(clone);
  document.body.appendChild(container);

  try {
    await document.fonts?.ready;
    await inlineImages(clone);
    await waitForImages(clone);
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const width = Math.ceil(clone.scrollWidth);
    const height = Math.ceil(clone.scrollHeight);
    const scale = Math.min(CAPTURE_SCALE, MAX_OUTPUT_WIDTH / width);
    const contentCanvas = await html2canvas(clone, {
      allowTaint: false,
      backgroundColor: "#FFF8E8",
      height,
      ignoreElements: (element) =>
        element instanceof HTMLElement &&
        element.hasAttribute("data-bracket-share-control"),
      logging: false,
      scale,
      useCORS: true,
      width,
      windowHeight: height,
      windowWidth: width,
    });

    const canvasHeight = height + HEADER_HEIGHT + FOOTER_HEIGHT;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(canvasHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("当前浏览器不支持图片生成。");
    }

    ctx.fillStyle = "#FFF8E8";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(contentCanvas, 0, Math.round(HEADER_HEIGHT * scale));
    ctx.scale(scale, scale);
    await drawShareMarks(ctx, width, canvasHeight, height, tournamentName);

    return canvas;
  } finally {
    container.remove();
  }
}

async function drawShareMarks(
  ctx: CanvasRenderingContext2D,
  width: number,
  canvasHeight: number,
  contentHeight: number,
  tournamentName: string,
) {
  const logoImage = await loadCleanImage(imageSource(logo));
  const logoBox = { x: 24, y: 17, width: 250, height: 78 };
  fillRoundedRect(ctx, logoBox, 24, "#FFFCF4", "#EED8AA", 2);

  if (logoImage) {
    drawImageContain(ctx, logoImage, logoBox.x + 22, logoBox.y + 17, 206, 44);
  } else {
    ctx.fillStyle = "#B9854C";
    ctx.font = "700 25px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Butter Vote", logoBox.x + logoBox.width / 2, logoBox.y + 48);
  }

  const infoBoxWidth = Math.min(620, Math.max(360, width * 0.34));
  const infoBox = {
    x: width - infoBoxWidth - 28,
    y: canvasHeight - 98,
    width: infoBoxWidth,
    height: 84,
  };
  fillRoundedRect(ctx, infoBox, 24, "#FFFCF4", "#EED8AA", 2);

  ctx.fillStyle = "#EED8AA";
  ctx.fillRect(24, HEADER_HEIGHT - 1, width - 48, 2);
  ctx.fillRect(24, HEADER_HEIGHT + contentHeight + 1, width - 48, 2);

  ctx.textAlign = "right";
  ctx.fillStyle = "#5C321E";
  ctx.font = "700 24px sans-serif";
  ctx.fillText(
    ellipsizeText(ctx, tournamentName, infoBox.width - 48),
    infoBox.x + infoBox.width - 24,
    infoBox.y + 32,
  );
  ctx.fillStyle = "#B9854C";
  ctx.font = "700 21px sans-serif";
  ctx.fillText("@SiriNatsume", infoBox.x + infoBox.width - 24, infoBox.y + 62);
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("图片生成失败。"));
      }
    }, "image/png");
  });
}

function safeFilenamePart(value: string) {
  return (
    value
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "tournament"
  );
}

function downloadBlob(blob: Blob, tournamentName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `buttervote-${safeFilenamePart(tournamentName)}-bracket.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function copyBlob(blob: Blob) {
  if (!navigator.clipboard || !("ClipboardItem" in window)) {
    return false;
  }

  await navigator.clipboard.write([
    new ClipboardItem({
      "image/png": blob,
    }),
  ]);
  return true;
}

export function TournamentBracketShareButton({
  bracket,
}: {
  bracket: ShareBracket;
}) {
  const [isGenerating, setIsGenerating] = useState(false);

  async function handleShare(event: MouseEvent<HTMLButtonElement>) {
    const root = event.currentTarget.closest<HTMLElement>("[data-bracket-share-root]");
    if (!root) {
      toast.error("没有找到可分享的对阵图。");
      return;
    }

    setIsGenerating(true);
    try {
      const canvas = await elementToCanvas(root, bracket.tournament.name);
      const blob = await canvasToBlob(canvas);
      const copied = await copyBlob(blob).catch(() => false);

      if (copied) {
        toast.success("对阵图图片已复制，可以直接粘贴分享");
      } else {
        downloadBlob(blob, bracket.tournament.name);
        toast.success("浏览器不支持直接复制，已下载对阵图图片");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "生成分享图片失败");
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleShare}
      disabled={isGenerating}
      data-bracket-share-control
    >
      {isGenerating ? (
        <Download className="size-4 animate-pulse" aria-hidden="true" />
      ) : (
        <Share2 className="size-4" aria-hidden="true" />
      )}
      {isGenerating ? "生成中" : "分享对阵图"}
    </Button>
  );
}
