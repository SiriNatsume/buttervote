import type { CharacterSource } from "./types";

// Only the providers' static character image directories are fetchable. Never
// accept arbitrary URLs or follow redirects from this authenticated proxy.
export function isCharacterImageUrl(source: CharacterSource, value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return false;
    if (!/\.(?:jpe?g|png|webp)$/i.test(url.pathname)) return false;

    switch (source) {
      case "bangumi":
        return url.hostname === "lain.bgm.tv" && /^(?:\/r\/\d{1,4})?\/pic\/crt\/[a-z]\/[\w/-]+\.(?:jpe?g|png|webp)$/i.test(url.pathname);
      case "anilist":
        return url.hostname === "s4.anilist.co" && /^\/file\/anilistcdn\/character\/(?:large|medium)\/[\w.-]+\.(?:jpe?g|png|webp)$/i.test(url.pathname);
      case "vndb":
        return ["t.vndb.org", "s.vndb.org"].includes(url.hostname) && /^\/ch\/\d+\/\d+\.(?:jpe?g|png|webp)$/i.test(url.pathname);
      default:
        return false;
    }
  } catch {
    return false;
  }
}

export function hasCharacterImageSignature(bytes: Uint8Array, contentType: string): boolean {
  if (contentType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === "image/png") return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value);
  if (contentType === "image/webp") return bytes.length >= 12 &&
    [0x52, 0x49, 0x46, 0x46].every((value, index) => bytes[index] === value) &&
    [0x57, 0x45, 0x42, 0x50].every((value, index) => bytes[index + 8] === value);
  return false;
}

export const MAX_CHARACTER_IMAGE_BYTES = 10 * 1024 * 1024;

export async function fetchCharacterImage(
  source: CharacterSource,
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; contentType: string }> {
  if (!isCharacterImageUrl(source, url)) throw new Error("角色图片地址无效。");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetcher(url, {
      // workerd does not implement "error"; return redirects without following
      // them, then reject every non-success response below.
      redirect: "manual",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
      headers: { Accept: "image/jpeg,image/png,image/webp" },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("角色图片暂时无法下载，请换一张图片或稍后重试。");
    }
    const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
    if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
      await response.body?.cancel();
      throw new Error("仅支持 JPG、PNG 或 WebP 角色图片。");
    }
    if (Number(response.headers.get("content-length")) > MAX_CHARACTER_IMAGE_BYTES) {
      await response.body?.cancel();
      throw new Error("角色原图不能超过 10MB。");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("角色图片内容为空。");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_CHARACTER_IMAGE_BYTES) {
        await reader.cancel();
        throw new Error("角色原图不能超过 10MB。");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    if (!hasCharacterImageSignature(bytes, contentType)) throw new Error("角色图片内容与格式不匹配。");
    return { bytes, contentType };
  } finally {
    clearTimeout(timeout);
  }
}
