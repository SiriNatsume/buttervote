import "server-only";

import { loadButterVoteLogoDataUrl } from "@/lib/export-image/brand-signature";
import { getPublicImageUrl } from "@/lib/image/image-url";
import { renderBracketImageLayout } from "@/lib/bracket-image/layout";
import type { BracketImageData } from "@/lib/bracket-image/types";
import { cachedExportAsset } from "@/lib/export-image/asset-cache";
import { fetchExportAssetBytes } from "@/lib/export-image/asset-fetch";

type CloudflareImageRequestInit = RequestInit & {
  cf?: {
    image?: {
      width?: number;
      height?: number;
      fit?: "cover" | "contain" | "scale-down" | "crop" | "pad";
      format?: "jpeg";
      quality?: number;
    };
  };
};

const MAX_EMBEDDED_IMAGE_BYTES = 2 * 1024 * 1024;
const EMBEDDED_PARTICIPANT_IMAGE_SIZE = 256;

function imageUrlForPath(imagePath: string) {
  if (/^https?:\/\//i.test(imagePath) || imagePath.startsWith("data:")) {
    return imagePath;
  }

  return getPublicImageUrl(imagePath);
}

function supportedImageContentType(bytes: Uint8Array) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

function imageFetchInit(): CloudflareImageRequestInit {
  return {
    cache: "force-cache",
    headers: { accept: "image/png,image/jpeg,*/*;q=0.1" },
    cf: {
      image: {
        width: EMBEDDED_PARTICIPANT_IMAGE_SIZE,
        height: EMBEDDED_PARTICIPANT_IMAGE_SIZE,
        fit: "cover",
        format: "jpeg",
        quality: 86,
      },
    },
  };
}

async function fetchImageDataUrl(imagePath: string, revision?: string | null) {
  if (imagePath.startsWith("data:")) return imagePath;
  const source = imageUrlForPath(imagePath);
  if (!source) return null;
  const url = new URL(source);
  if (revision) url.searchParams.set("bv", revision);
  try {
    const options = { maxBytes: MAX_EMBEDDED_IMAGE_BYTES, timeoutMs: 6000, init: imageFetchInit() };
    const bytes = revision ? await cachedExportAsset(url.href, {
      ...options, namespace: "bracket-avatar-v1", revision: `jpeg-256-q86:${revision}`,
      owner: source,
      ttlMs: 7 * 86_400_000, validate: (value) => supportedImageContentType(value) !== null,
    }) : await fetchExportAssetBytes(url.href, options);
    const contentType = supportedImageContentType(bytes);
    return contentType ? `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}` : null;
  } catch (error) {
    console.warn("Failed to embed bracket image asset.", error instanceof Error ? error.message : "asset unavailable");
    return null;
  }
}

export async function renderBracketImageWithAssets(data: BracketImageData, revisions: Readonly<Record<string, string | null>> = {}) {
  const paths = [...new Set(data.matches
    .flatMap((match) => [match.left?.imagePath, match.right?.imagePath])
    .filter((imagePath): imagePath is string => Boolean(imagePath)))];
  const [logoDataUrl, imageEntries] = await Promise.all([
    loadButterVoteLogoDataUrl(),
    Promise.all(paths.map(async (imagePath) =>
      [imagePath, Object.prototype.hasOwnProperty.call(revisions, imagePath)
        && revisions[imagePath] === null && !/^(https?:|data:)/i.test(imagePath)
        ? null : await fetchImageDataUrl(imagePath, revisions[imagePath])] as const)),
  ]);
  return {
    svg: renderBracketImageLayout(data, { logoDataUrl, participantImages: new Map(imageEntries) }),
    complete: imageEntries.every(([, value]) => Boolean(value)),
  };
}

export async function renderBracketImageSvg(data: BracketImageData) {
  return (await renderBracketImageWithAssets(data)).svg;
}
