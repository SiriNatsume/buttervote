import "server-only";
import { canonicalFontCharacters, svgFontWeights } from "./font-text";
import { cachedExportAsset } from "@/lib/export-image/asset-cache";

export const BRACKET_EXPORT_FONT_FAMILY = "Noto Sans SC";

const GOOGLE_FONTS_CSS_URL = "https://fonts.googleapis.com/css2";
const FALLBACK_TEXT =
  "Butter Vote @SuperCUT Butter Group BV 0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz -_.=/()[]:;,+ " +
  "\u5f85\u5b9a\u5f85\u751f\u6210\u672a\u5f00\u59cb\u7b49\u5f85\u5f00\u59cb\u6295\u7968\u4e2d\u7ed3\u679c\u53ef\u89c1\u7ed3\u679c\u5f85\u516c\u5f00\u5df2\u516c\u5f00 " +
  "\u7ec4\u9884\u8d5b\u7b2c\u6d77\u9009\u8d5b\u7a0b\u5e2d\u4f4d\u5f3a\u534a\u51b3\u8d5b\u51a0\u519b\u8d5b\u5b63\u519b\u8d5b\u51a0\u519b\u573a\u7eff\u8272\u83b7\u80dc\u6570\u5b57\u5f97\u7968" +
  "赛事对阵全程赛果当前赛程位参赛角色场对决已公开角色已生成对阵正赛已结束投票中等待结果公开" +
  "赛程进行中等待赛程生成等待晋级确认等待开始赛程待定截止待揭晓冠军待定同分判定预赛同组排名更高者获胜" +
  "海选排名更高者获胜按赛事规则决定胜者本场获胜冠军晋级路线季军赛路线分享对阵图数据更新以活动当前公开赛果为准";

const FONT_URL_PATTERN = /url\((?:"|')?([^"')]+)(?:"|')?\)/g;
const TEXT_NODE_PATTERN = /<text\b[^>]*>([\s\S]*?)<\/text>/g;

const fontBuffersByText = new Map<string, Promise<Uint8Array[]>>();

function fontUrlsFromCss(bytes: Uint8Array) {
  const urls = [...new Set(Array.from(new TextDecoder().decode(bytes).matchAll(FONT_URL_PATTERN), (match) => match[1]))];
  if (!urls.length) return null;
  try {
    return urls.every((value) => {
      const url = new URL(value);
      return url.protocol === "https:" && url.hostname === "fonts.gstatic.com";
    }) ? urls : null;
  } catch { return null; }
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    );
}

function extractSvgText(svg: string) {
  const values: string[] = [];
  for (const match of svg.matchAll(TEXT_NODE_PATTERN)) {
    values.push(decodeXmlEntities(match[1].replace(/<[^>]+>/g, "")));
  }

  return canonicalFontCharacters(`${values.join("")}${FALLBACK_TEXT}`);
}

function fontCssUrl(text: string, weights: number[]) {
  const url = new URL(GOOGLE_FONTS_CSS_URL);
  url.searchParams.set(
    "family",
    `${BRACKET_EXPORT_FONT_FAMILY}:wght@${weights.join(";")}`,
  );
  url.searchParams.set("display", "swap");
  url.searchParams.set("text", text);
  return url.toString();
}

async function loadFontBuffersForText(text: string, weights: number[]) {
  try {
    const cssBytes = await cachedExportAsset(fontCssUrl(text, weights), {
      namespace: "export-font-css-v1", revision: "noto-sc-v1", ttlMs: 30 * 86_400_000,
      maxBytes: 256 * 1024,
      validate: (bytes) => fontUrlsFromCss(bytes) !== null,
    });
    const fontUrls = fontUrlsFromCss(cssBytes);
    if (!fontUrls) throw new Error("Font CSS did not yield supported font files");
    return await Promise.all(fontUrls.map((url) => cachedExportAsset(url, {
      namespace: "export-font-file-v1", revision: "noto-sc-v1", ttlMs: 30 * 86_400_000,
      maxBytes: 2 * 1024 * 1024,
      validate: (bytes) => bytes.length > 256 && ((bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0)
        || ["OTTO", "ttcf"].includes(new TextDecoder().decode(bytes.subarray(0, 4)))),
    })));
  } catch (error) {
    console.error("Failed to load bracket export font.", error);
    return [];
  }
}

export function loadBracketExportFontBuffers(svg: string) {
  const text = extractSvgText(svg);
  const weights = svgFontWeights(svg);
  const cacheKey = `${weights.join(",")}:${text}`;

  if (fontBuffersByText.size >= 20 && !fontBuffersByText.has(cacheKey)) {
    const oldest = fontBuffersByText.keys().next().value;
    if (oldest !== undefined) fontBuffersByText.delete(oldest);
  }

  let promise = fontBuffersByText.get(cacheKey);
  if (promise) {
    fontBuffersByText.delete(cacheKey);
    fontBuffersByText.set(cacheKey, promise);
  }
  if (!promise) {
    promise = loadFontBuffersForText(text, weights).then((buffers) => {
      if (buffers.length === 0) {
        fontBuffersByText.delete(cacheKey);
      }
      return buffers;
    });
    fontBuffersByText.set(cacheKey, promise);
  }

  return promise;
}
