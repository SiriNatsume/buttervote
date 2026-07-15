export type CroppedAreaPixels = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type GetCroppedImageBlobParams = {
  imageSrc: string;
  croppedAreaPixels: CroppedAreaPixels;
  outputWidth: number;
  outputHeight: number;
  mimeType?: "image/webp" | "image/jpeg";
  quality?: number;
  maxSizeBytes?: number;
};

export type GetImageThumbnailBlobParams = {
  maxWidth?: number;
  maxHeight?: number;
  mimeType?: "image/webp" | "image/jpeg";
  quality?: number;
  maxSizeBytes?: number;
};

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const MAX_SOURCE_IMAGE_SIZE = 30 * 1024 * 1024;

export function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("无法读取图片文件，请重新选择。"));
    });
    reader.addEventListener("error", () => {
      reject(new Error("读取图片文件失败，请重新选择。"));
    });
    reader.readAsDataURL(file);
  });
}

export function validateImageFile(file: File): void {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error("仅支持 JPG、PNG 或 WebP 图片，不支持 SVG、GIF 或其他格式。");
  }

  if (file.size > MAX_SOURCE_IMAGE_SIZE) {
    throw new Error("原图不能超过 30MB，请选择更小的图片。");
  }
}

function loadImage(imageSrc: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", () => {
      reject(new Error("图片加载失败，请重新选择。"));
    });
    image.decoding = "async";
    image.src = imageSrc;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: "image/webp" | "image/jpeg",
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("图片导出失败，请换一张图片后重试。"));
          return;
        }

        resolve(blob);
      },
      mimeType,
      quality,
    );
  });
}

export async function getImageThumbnailBlob(
  file: File,
  {
    maxWidth = 480,
    maxHeight = 640,
    mimeType = "image/webp",
    quality = 0.8,
    maxSizeBytes,
  }: GetImageThumbnailBlobParams = {},
): Promise<{
  blob: Blob;
  width: number;
  height: number;
  size: number;
}> {
  const imageUrl = URL.createObjectURL(file);

  try {
    const image = await loadImage(imageUrl);
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    const scale = Math.min(
      1,
      maxWidth / sourceWidth,
      maxHeight / sourceHeight,
    );
    const outputWidth = Math.max(1, Math.round(sourceWidth * scale));
    const outputHeight = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = outputWidth;
    canvas.height = outputHeight;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("当前浏览器不支持生成缩略图，请换一个浏览器重试。");
    }

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, outputWidth, outputHeight);

    const qualityCandidates = [quality, 0.74, 0.68, 0.6].filter(
      (item, index, values) => values.indexOf(item) === index,
    );
    let outputMimeType = mimeType;
    let lastBlob: Blob | null = null;

    for (const nextQuality of qualityCandidates) {
      let blob = await canvasToBlob(canvas, outputMimeType, nextQuality);

      if (outputMimeType === "image/webp" && blob.type !== "image/webp") {
        outputMimeType = "image/jpeg";
        blob = await canvasToBlob(canvas, outputMimeType, nextQuality);
      }

      lastBlob = blob;
      if (!maxSizeBytes || blob.size <= maxSizeBytes) {
        return {
          blob,
          width: outputWidth,
          height: outputHeight,
          size: blob.size,
        };
      }
    }

    const maxSizeKb = maxSizeBytes
      ? Math.round(maxSizeBytes / 1024)
      : undefined;
    throw new Error(
      maxSizeKb && lastBlob
        ? `缩略图压缩后仍超过 ${maxSizeKb}KB，请换一张图片后重试。`
        : "缩略图生成失败，请换一张图片后重试。",
    );
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

export async function getCroppedImageBlob({
  imageSrc,
  croppedAreaPixels,
  outputWidth,
  outputHeight,
  mimeType = "image/webp",
  quality = 0.82,
  maxSizeBytes,
}: GetCroppedImageBlobParams): Promise<{
  blob: Blob;
  width: number;
  height: number;
  size: number;
}> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = outputWidth;
  canvas.height = outputHeight;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("当前浏览器不支持图片裁剪，请换一个浏览器重试。");
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    croppedAreaPixels.x,
    croppedAreaPixels.y,
    croppedAreaPixels.width,
    croppedAreaPixels.height,
    0,
    0,
    outputWidth,
    outputHeight,
  );

  const qualityCandidates = [quality, 0.76, 0.7].filter(
    (item, index, values) => values.indexOf(item) === index,
  );

  let lastBlob: Blob | null = null;
  let outputMimeType = mimeType;

  for (const nextQuality of qualityCandidates) {
    let blob = await canvasToBlob(canvas, outputMimeType, nextQuality);

    if (outputMimeType === "image/webp" && blob.type !== "image/webp") {
      outputMimeType = "image/jpeg";
      blob = await canvasToBlob(canvas, outputMimeType, nextQuality);
    }

    lastBlob = blob;

    if (!maxSizeBytes || blob.size <= maxSizeBytes) {
      return {
        blob,
        width: outputWidth,
        height: outputHeight,
        size: blob.size,
      };
    }
  }

  const maxSizeKb = maxSizeBytes
    ? Math.round(maxSizeBytes / 1024)
    : undefined;
  throw new Error(
    maxSizeKb && lastBlob
      ? `图片压缩后仍超过 ${maxSizeKb}KB，请换一张图或缩小裁剪范围。`
      : "图片压缩失败，请换一张图片后重试。",
  );
}
