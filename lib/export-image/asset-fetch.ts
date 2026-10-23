type AssetOptions = {
  timeoutMs?: number;
  maxBytes: number;
  init?: RequestInit;
  fetcher?: typeof fetch;
};

// The deadline covers headers AND the body. A slow font body must not leave
// the share button waiting after a headers-only timeout has already cleared.
export async function fetchExportAssetBytes(url: string, {
  timeoutMs = 8000, maxBytes, init, fetcher = fetch,
}: AssetOptions): Promise<Uint8Array> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`Export asset request failed (${response.status})`);
    if (Number(response.headers.get("content-length") ?? 0) > maxBytes) throw new Error("Export asset exceeds its size limit");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.byteLength || bytes.byteLength > maxBytes) throw new Error("Export asset has an invalid size");
    return bytes;
  } finally {
    clearTimeout(timeout);
  }
}
