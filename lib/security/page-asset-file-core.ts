import { fileTypeFromBuffer } from "file-type";
import {
  pageAssetRules,
  type PageAssetRule,
} from "@/lib/page-assets";
import type { PageAssetExtension } from "@/lib/types";

const extensionAliases: Record<string, PageAssetExtension> = {
  jpeg: "jpg",
};

function extensionFromFilename(filename: string) {
  const dot = filename.lastIndexOf(".");
  if (dot < 1 || dot === filename.length - 1) return null;
  const rawExtension = filename.slice(dot + 1).toLowerCase();
  const extension = extensionAliases[rawExtension] ?? rawExtension;
  return extension in pageAssetRules
    ? (extension as PageAssetExtension)
    : null;
}

export type ValidatedPageAsset = {
  rule: PageAssetRule;
  originalFilename: string;
  safeFilename: string;
};

function sanitizeFilename(filename: string, extension: PageAssetExtension) {
  const basename = filename
    .replace(/\.[^.]+$/, "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return `${basename || "file"}.${extension}`;
}

// SECURITY CRITICAL: never trust the browser-provided extension or MIME alone.
export async function validatePageAssetFile(
  file: File,
): Promise<ValidatedPageAsset | { error: string }> {
  const extension = extensionFromFilename(file.name);
  if (!extension) return { error: "不支持该文件扩展名。" };

  const rule = pageAssetRules[extension];
  if (file.size <= 0 || file.size > rule.maxSize) {
    return {
      error:
        rule.assetType === "image"
          ? "图片必须小于或等于 10 MB。"
          : "附件必须小于或等于 50 MB。",
    };
  }

  const browserMime = file.type.toLowerCase();
  const genericAttachmentMimes = new Set(["", "application/octet-stream"]);
  const compatibleArchiveMimes = new Set([
    "application/zip",
    "application/x-rar-compressed",
    "application/vnd.rar",
  ]);
  if (
    rule.assetType === "image" &&
    browserMime !== rule.mimeType
  ) {
    return { error: "浏览器报告的图片类型与扩展名不匹配。" };
  }
  if (
    rule.assetType === "attachment" &&
    !genericAttachmentMimes.has(browserMime) &&
    browserMime !== rule.mimeType &&
    !compatibleArchiveMimes.has(browserMime)
  ) {
    return { error: "浏览器报告的附件类型与扩展名不匹配。" };
  }

  const buffer = new Uint8Array(await file.arrayBuffer());
  let detected: Awaited<ReturnType<typeof fileTypeFromBuffer>>;
  try {
    detected = await fileTypeFromBuffer(buffer);
  } catch {
    return { error: "无法识别文件内容。" };
  }
  const detectedExtension = detected?.ext === "jpeg" ? "jpg" : detected?.ext;
  if (detectedExtension !== extension || detected?.mime !== rule.mimeType) {
    return { error: "文件内容与扩展名不匹配。" };
  }

  return {
    rule,
    originalFilename: sanitizeFilename(file.name, extension),
    safeFilename: sanitizeFilename(file.name, extension),
  };
}
