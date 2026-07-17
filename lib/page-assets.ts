import type {
  PageAssetExtension,
  PageAssetType,
  PageVisibility,
} from "@/lib/types";

export const PAGE_ASSET_BUCKET = "page-assets";
export const PAGE_ASSET_IMAGE_MAX_SIZE = 10 * 1024 * 1024;
export const PAGE_ASSET_FILE_MAX_SIZE = 50 * 1024 * 1024;
export const PAGE_ASSET_DEFAULT_VISIBILITY: PageVisibility = "admin_only";

export function defaultPageAssetVisibilityForPage(
  pageVisibility: PageVisibility,
) {
  return pageVisibility;
}

export type PageAssetRule = {
  extension: PageAssetExtension;
  mimeType: string;
  assetType: PageAssetType;
  maxSize: number;
};

export const pageAssetRules: Record<PageAssetExtension, PageAssetRule> = {
  jpg: {
    extension: "jpg",
    mimeType: "image/jpeg",
    assetType: "image",
    maxSize: PAGE_ASSET_IMAGE_MAX_SIZE,
  },
  png: {
    extension: "png",
    mimeType: "image/png",
    assetType: "image",
    maxSize: PAGE_ASSET_IMAGE_MAX_SIZE,
  },
  webp: {
    extension: "webp",
    mimeType: "image/webp",
    assetType: "image",
    maxSize: PAGE_ASSET_IMAGE_MAX_SIZE,
  },
  pdf: {
    extension: "pdf",
    mimeType: "application/pdf",
    assetType: "attachment",
    maxSize: PAGE_ASSET_FILE_MAX_SIZE,
  },
  "7z": {
    extension: "7z",
    mimeType: "application/x-7z-compressed",
    assetType: "attachment",
    maxSize: PAGE_ASSET_FILE_MAX_SIZE,
  },
  rar: {
    extension: "rar",
    mimeType: "application/x-rar-compressed",
    assetType: "attachment",
    maxSize: PAGE_ASSET_FILE_MAX_SIZE,
  },
  xlsx: {
    extension: "xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    assetType: "attachment",
    maxSize: PAGE_ASSET_FILE_MAX_SIZE,
  },
  docx: {
    extension: "docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    assetType: "attachment",
    maxSize: PAGE_ASSET_FILE_MAX_SIZE,
  },
  pptx: {
    extension: "pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    assetType: "attachment",
    maxSize: PAGE_ASSET_FILE_MAX_SIZE,
  },
};

export const pageAssetExtensions = Object.keys(
  pageAssetRules,
) as PageAssetExtension[];

export function pageAssetUrl(assetId: string, download = false) {
  return `/api/page-assets/${assetId}${download ? "?download=1" : ""}`;
}

export function pageAssetMarkdown(input: {
  id: string;
  filename: string;
  assetType: PageAssetType;
}) {
  const escapedLabel = input.filename.replace(/[\[\]]/g, "\\$&");
  const url = pageAssetUrl(input.id);
  return input.assetType === "image"
    ? `![${escapedLabel}](${url})`
    : `[${escapedLabel}](${url})`;
}

export const pageAssetVisibilityLabel: Record<PageVisibility, string> = {
  admin_only: "管理可见",
  public: "所有人可见",
};
