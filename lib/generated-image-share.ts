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

  if (!response.ok) {
    const message = await response.text().catch(() => "");
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
  URL.revokeObjectURL(url);
}

export async function copyPngBlobToClipboard(blob: Blob) {
  if (
    typeof navigator === "undefined" ||
    !navigator.clipboard ||
    typeof window === "undefined" ||
    !("ClipboardItem" in window)
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
