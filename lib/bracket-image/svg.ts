import "server-only";

import { loadButterVoteLogoDataUrl } from "@/lib/export-image/brand-signature";
import { getPublicImageUrl } from "@/lib/image/image-url";
import { renderBracketImageLayout } from "@/lib/bracket-image/layout";
import type { BracketImageData } from "@/lib/bracket-image/types";

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

function supportedImageContentType(bytes: Uint8Array, contentType: string) {
  const normalized = contentType.toLowerCase();
  const isPng =
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47;
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

  if (isPng) {
    return "image/png";
  }
  if (isJpeg) {
    return "image/jpeg";
  }
  if (normalized === "image/png" || normalized === "image/jpeg") {
    return normalized;
  }

  return null;
}

function imageFetchInit(signal: AbortSignal): CloudflareImageRequestInit {
  return {
    cache: "force-cache",
    headers: { accept: "image/png,image/jpeg,*/*;q=0.1" },
    signal,
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

async function fetchImageDataUrl(imagePath: string | null) {
  if (!imagePath) {
    return null;
  }

  if (imagePath.startsWith("data:")) {
    return imagePath;
  }

  const url = imageUrlForPath(imagePath);
  if (!url) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try {
    const response = await fetch(url, imageFetchInit(controller.signal));

    if (!response.ok) {
      return null;
    }

    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > MAX_EMBEDDED_IMAGE_BYTES) {
      console.error("Bracket image asset is too large to embed.", {
        imagePath,
        contentLength,
      });
      return null;
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    const contentType = supportedImageContentType(
      bytes,
      response.headers.get("content-type")?.split(";")[0] || "",
    );

    if (!contentType) {
      console.error("Bracket image asset type is not supported by resvg.", {
        imagePath,
        responseType: response.headers.get("content-type"),
      });
      return null;
    }

    return `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch (error) {
    console.error("Failed to embed bracket image asset.", error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function renderBracketImageSvg(data: BracketImageData) {
  const paths = [...new Set(data.matches
    .flatMap((match) => [match.left?.imagePath, match.right?.imagePath])
    .filter((imagePath): imagePath is string => Boolean(imagePath)))];
  const [logoDataUrl, imageEntries] = await Promise.all([
    loadButterVoteLogoDataUrl(),
    Promise.all(paths.map(async (imagePath) =>
      [imagePath, await fetchImageDataUrl(imagePath)] as const)),
  ]);
  return renderBracketImageLayout(data, {
    logoDataUrl,
    participantImages: new Map(imageEntries),
  });
}
