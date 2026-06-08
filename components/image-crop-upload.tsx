"use client";

import { ChangeEvent, useMemo, useRef, useState } from "react";
import Cropper, { type Area, type Point } from "react-easy-crop";
import { ImagePlus, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import {
  getCroppedImageBlob,
  readFileAsDataURL,
  validateImageFile,
} from "@/lib/image/crop-image";
import { toUserFacingError } from "@/lib/action-error";
import { getPublicImageUrl } from "@/lib/image/image-url";
import { cn } from "@/lib/utils";
import { LoadingButton } from "@/components/loading-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";

export type ImageCropMode = "contest-cover" | "candidate-image";
const MIN_CROP_ZOOM = 0.5;

export type ImageCropUploadProps = {
  mode: ImageCropMode;
  bucket?: string;
  storagePath: string;
  value?: {
    imagePath?: string | null;
    imageWidth?: number | null;
    imageHeight?: number | null;
    imageSize?: number | null;
  };
  onUploaded: (result: {
    imagePath: string;
    imageWidth: number;
    imageHeight: number;
    imageSize: number;
    publicUrl: string;
  }) => void | Promise<void>;
  disabled?: boolean;
};

const modeConfig: Record<
  ImageCropMode,
  {
    label: string;
    title: string;
    aspect: number;
    outputWidth: number;
    outputHeight: number;
    maxSizeBytes: number;
    previewClassName: string;
  }
> = {
  "contest-cover": {
    label: "上传封面",
    title: "裁剪活动封面",
    aspect: 16 / 9,
    outputWidth: 1280,
    outputHeight: 720,
    maxSizeBytes: 1024 * 1024,
    previewClassName: "aspect-video",
  },
  "candidate-image": {
    label: "上传图片",
    title: "裁剪候选项图片",
    aspect: 1,
    outputWidth: 768,
    outputHeight: 768,
    maxSizeBytes: 800 * 1024,
    previewClassName: "aspect-square",
  },
};

export function ImageCropUpload({
  mode,
  bucket = "vote-images",
  storagePath,
  value,
  onUploaded,
  disabled = false,
}: ImageCropUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const config = modeConfig[mode];
  const [previewUrl, setPreviewUrl] = useState<string | null>(() =>
    getPublicImageUrl(value?.imagePath),
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const metaText = useMemo(() => {
    if (!value?.imageWidth || !value?.imageHeight || !value?.imageSize) {
      return null;
    }

    return `${value.imageWidth} x ${value.imageHeight} · ${Math.round(
      value.imageSize / 1024,
    )}KB`;
  }, [value?.imageHeight, value?.imageSize, value?.imageWidth]);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    try {
      setError(null);
      validateImageFile(file);
      const dataUrl = await readFileAsDataURL(file);
      setImageSrc(dataUrl);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setCroppedAreaPixels(null);
      setDialogOpen(true);
    } catch (nextError) {
      const message = toUserFacingError(
        nextError instanceof Error ? nextError.message : "图片文件无效。",
      );
      setError(message);
      toast.error(message);
    }
  }

  async function handleConfirmCrop() {
    if (!imageSrc || !croppedAreaPixels) {
      setError("请先选择裁剪区域。");
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      const result = await getCroppedImageBlob({
        imageSrc,
        croppedAreaPixels,
        outputWidth: config.outputWidth,
        outputHeight: config.outputHeight,
        mimeType: "image/webp",
        quality: 0.82,
        maxSizeBytes: config.maxSizeBytes,
      });

      const formData = new FormData();
      formData.set("bucket", bucket);
      formData.set("storagePath", storagePath);
      formData.set("file", result.blob, "image.webp");

      const uploadResponse = await fetch("/api/uploads/vote-image", {
        method: "POST",
        body: formData,
      });
      const uploadResult = (await uploadResponse.json().catch(() => null)) as
        | { publicUrl?: string; error?: string }
        | null;

      if (!uploadResponse.ok || !uploadResult?.publicUrl) {
        throw new Error(uploadResult?.error ?? "上传失败，请稍后重试。");
      }

      await onUploaded({
        imagePath: storagePath,
        imageWidth: result.width,
        imageHeight: result.height,
        imageSize: result.size,
        publicUrl: uploadResult.publicUrl,
      });

      setPreviewUrl(uploadResult.publicUrl);
      setDialogOpen(false);
      setImageSrc(null);
      toast.success("上传成功");
    } catch (nextError) {
      const message = toUserFacingError(
        nextError instanceof Error ? nextError.message : "上传失败，请稍后重试。",
      );
      setError(message);
      toast.error(message);
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div
        className={cn(
          "relative overflow-hidden rounded-2xl border bg-muted",
          config.previewClassName,
        )}
      >
        {previewUrl ? (
          <img
            src={previewUrl}
            alt="已上传图片"
            className="size-full object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground">
            <ImagePlus className="size-8" aria-hidden="true" />
          </div>
        )}
      </div>

      {metaText ? (
        <p className="text-xs text-muted-foreground">{metaText}</p>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        disabled={disabled || isUploading}
        onChange={handleFileChange}
      />
      <LoadingButton
        type="button"
        variant="outline"
        disabled={disabled || isUploading}
        loading={isUploading}
        loadingText="上传中..."
        onClick={() => inputRef.current?.click()}
      >
        <UploadCloud className="size-4" />
        {previewUrl ? "替换图片" : config.label}
      </LoadingButton>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!isUploading) {
            setDialogOpen(open);
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{config.title}</DialogTitle>
            <DialogDescription>
              输出 {config.outputWidth} x {config.outputHeight}
            </DialogDescription>
          </DialogHeader>
          {imageSrc ? (
            <div className="space-y-5">
              <div className="relative h-[360px] overflow-hidden rounded-2xl border bg-black">
                <Cropper
                  image={imageSrc}
                  crop={crop}
                  zoom={zoom}
                  minZoom={MIN_CROP_ZOOM}
                  maxZoom={3}
                  aspect={config.aspect}
                  onCropChange={setCrop}
                  onZoomChange={setZoom}
                  onCropComplete={(_, areaPixels) =>
                    setCroppedAreaPixels(areaPixels)
                  }
                />
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">缩放</span>
                  <span className="text-muted-foreground">
                    {zoom.toFixed(1)}x
                  </span>
                </div>
                <Slider
                  value={[zoom]}
                  min={MIN_CROP_ZOOM}
                  max={3}
                  step={0.1}
                  disabled={isUploading}
                  onValueChange={(value) => setZoom(value[0] ?? 1)}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={isUploading}
                  onClick={() => setDialogOpen(false)}
                >
                  取消
                </Button>
                <LoadingButton
                  type="button"
                  disabled={isUploading}
                  loading={isUploading}
                  loadingText="上传中..."
                  onClick={handleConfirmCrop}
                >
                  确认裁剪
                </LoadingButton>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
