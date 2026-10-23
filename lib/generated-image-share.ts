export function safeFilenamePart(value: string, fallback: string) {
  return (
    value
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || fallback
  );
}

export async function fetchPngBlob(url: string, fallbackErrorMessage: string) {
  const response = await fetch(url);
  return readPngBlob(response, fallbackErrorMessage);
}

export async function readPngBlob(response: Response, fallbackErrorMessage: string) {
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let message = text;
    try { message = JSON.parse(text).error ?? text; } catch { /* Plain-text errors are also supported. */ }
    throw new Error(message || fallbackErrorMessage);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("image/png")) {
    throw new Error("服务端未返回 PNG 图片。");
  }

  return response.blob();
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Let the browser start consuming the Blob before releasing its URL.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// Call before awaiting the network: Safari requires write() in the click's
// user activation. ClipboardItem can wait for a freshly authorized PNG Promise.
export async function copyPngBlobToClipboard(blob: Blob | Promise<Blob>) {
  if (
    typeof navigator === "undefined" ||
    typeof navigator.clipboard?.write !== "function" ||
    typeof window === "undefined" ||
    !("ClipboardItem" in window) ||
    (typeof ClipboardItem.supports === "function" && !ClipboardItem.supports("image/png"))
  ) {
    return false;
  }

  await navigator.clipboard.write([
    new ClipboardItem({
      "image/png": blob,
    }),
  ]);
  return true;
}

export async function sharePng(
  blob: Promise<Blob>, filename: string,
  actions = { copy: copyPngBlobToClipboard, download: downloadBlob },
) {
  // Start clipboard access synchronously, but never supply unvalidated bytes.
  const copying = actions.copy(blob).catch(() => false);
  const image = await blob;
  if (await copying) return "copied" as const;
  actions.download(image, filename);
  return "downloaded" as const;
}
