import "server-only";

export const BRACKET_EXPORT_FONT_FAMILY = "Noto Sans SC";

const FONT_WEIGHTS = ["700", "800", "900"] as const;
const GOOGLE_FONTS_CSS_URL = "https://fonts.googleapis.com/css2";
const FALLBACK_TEXT =
  "Butter Vote @SiriNatsume BV 0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz -_.=/()[]:;,+ " +
  "\u5f85\u5b9a\u5f85\u751f\u6210\u672a\u5f00\u59cb\u7b49\u5f85\u5f00\u59cb\u6295\u7968\u4e2d\u7ed3\u679c\u53ef\u89c1\u7ed3\u679c\u5f85\u516c\u5f00\u5df2\u516c\u5f00 " +
  "\u7ec4\u9884\u8d5b\u7b2c\u6d77\u9009\u8d5b\u7a0b\u5e2d\u4f4d\u5f3a\u534a\u51b3\u8d5b\u51a0\u519b\u8d5b\u5b63\u519b\u8d5b\u51a0\u519b\u573a\u7eff\u8272\u83b7\u80dc\u6570\u5b57\u5f97\u7968";

const FONT_URL_PATTERN = /url\((?:"|')?([^"')]+)(?:"|')?\)/g;
const TEXT_NODE_PATTERN = /<text\b[^>]*>([\s\S]*?)<\/text>/g;

const fontBuffersByText = new Map<string, Promise<Uint8Array[]>>();

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

function uniqueCharacters(value: string) {
  return Array.from(new Set(Array.from(value))).join("");
}

function extractSvgText(svg: string) {
  const values: string[] = [];
  for (const match of svg.matchAll(TEXT_NODE_PATTERN)) {
    values.push(decodeXmlEntities(match[1].replace(/<[^>]+>/g, "")));
  }

  return uniqueCharacters(`${values.join("")}${FALLBACK_TEXT}`);
}

function fontCssUrl(text: string) {
  const url = new URL(GOOGLE_FONTS_CSS_URL);
  url.searchParams.set(
    "family",
    `${BRACKET_EXPORT_FONT_FAMILY}:wght@${FONT_WEIGHTS.join(";")}`,
  );
  url.searchParams.set("display", "swap");
  url.searchParams.set("text", text);
  return url.toString();
}

async function fetchWithTimeout(url: string, timeoutMs = 6000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      cache: "force-cache",
      headers: { accept: "*/*" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function loadFontBuffersForText(text: string) {
  try {
    const cssResponse = await fetchWithTimeout(fontCssUrl(text));
    if (!cssResponse.ok) {
      throw new Error(`Font CSS request failed with ${cssResponse.status}`);
    }

    const css = await cssResponse.text();
    const fontUrls = [
      ...new Set(
        Array.from(css.matchAll(FONT_URL_PATTERN), (match) => match[1]),
      ),
    ];

    const responses = await Promise.all(
      fontUrls.map((fontUrl) => fetchWithTimeout(fontUrl, 8000)),
    );
    const buffers = await Promise.all(
      responses
        .filter((response) => response.ok)
        .map(async (response) => new Uint8Array(await response.arrayBuffer())),
    );

    if (buffers.length === 0) {
      throw new Error("Font CSS did not yield any downloadable font files");
    }

    return buffers;
  } catch (error) {
    console.error("Failed to load bracket export font.", error);
    return [];
  }
}

export function loadBracketExportFontBuffers(svg: string) {
  const text = extractSvgText(svg);

  if (fontBuffersByText.size > 20 && !fontBuffersByText.has(text)) {
    fontBuffersByText.clear();
  }

  let promise = fontBuffersByText.get(text);
  if (!promise) {
    promise = loadFontBuffersForText(text).then((buffers) => {
      if (buffers.length === 0) {
        fontBuffersByText.delete(text);
      }
      return buffers;
    });
    fontBuffersByText.set(text, promise);
  }

  return promise;
}
