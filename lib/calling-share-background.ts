import "server-only";

const SHARE_BACKGROUND_PATH = "/img/share.png";
const MAX_SHARE_BACKGROUND_BYTES = 2 * 1024 * 1024;

let shareBackgroundDataUrlPromise: Promise<string | null> | null = null;

function supportedShareBackgroundContentType(bytes: Uint8Array, responseType: string) {
  const normalized = responseType.toLowerCase();
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

async function responseToDataUrl(response: Response) {
  if (!response.ok) {
    return null;
  }

  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_SHARE_BACKGROUND_BYTES) {
    console.warn("Calling share background is too large to embed.");
    return null;
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_SHARE_BACKGROUND_BYTES) {
    console.warn("Calling share background is too large to embed.");
    return null;
  }

  const contentType = supportedShareBackgroundContentType(
    bytes,
    response.headers.get("content-type")?.split(";")[0] || "",
  );
  if (!contentType) {
    console.warn("Calling share background is not a supported image type.");
    return null;
  }

  return "data:" + contentType + ";base64," + Buffer.from(bytes).toString("base64");
}

async function loadFromCloudflareAssets(origin: string) {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env } = await getCloudflareContext({ async: true });
    if (!env.ASSETS) {
      return null;
    }

    return responseToDataUrl(
      await env.ASSETS.fetch(new Request(new URL(SHARE_BACKGROUND_PATH, origin))),
    );
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("Failed to load calling share background from Cloudflare assets.", error);
    }
    return null;
  }
}

async function loadFromPublicFetch(origin: string) {
  try {
    return responseToDataUrl(
      await fetch(new URL(SHARE_BACKGROUND_PATH, origin), { cache: "force-cache" }),
    );
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("Failed to load calling share background from public URL.", error);
    }
    return null;
  }
}

export function getCallingShareBackgroundDataUrl(origin: string) {
  const assetOrigin = origin || process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  shareBackgroundDataUrlPromise ??= (async () => {
    return (
      (await loadFromCloudflareAssets(assetOrigin)) ??
      (await loadFromPublicFetch(assetOrigin))
    );
  })();

  return shareBackgroundDataUrlPromise;
}