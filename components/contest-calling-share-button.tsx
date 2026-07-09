"use client";

import { useState } from "react";
import { Download, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  copyPngBlobToClipboard,
  downloadBlob,
  fetchPngBlob,
  safeFilenamePart,
} from "@/lib/generated-image-share";

export function ContestCallingShareButton({
  contestTitle,
  imageUrl,
  step,
}: {
  contestTitle: string;
  imageUrl: string;
  step: number;
}) {
  const [isGenerating, setIsGenerating] = useState(false);

  async function handleShare() {
    setIsGenerating(true);
    try {
      const blob = await fetchPngBlob(imageUrl, "唱票图生成失败。");
      const copied = await copyPngBlobToClipboard(blob).catch(() => false);

      if (copied) {
        toast.success("唱票图已复制，可以直接粘贴分享。");
      } else {
        downloadBlob(
          blob,
          `buttervote-${safeFilenamePart(contestTitle, "contest")}-calling-${step}.png`,
        );
        toast.success("浏览器不支持直接复制，已下载唱票图。");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "生成分享图片失败");
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleShare}
      disabled={isGenerating}
    >
      {isGenerating ? (
        <Download className="size-4 animate-pulse" aria-hidden="true" />
      ) : (
        <Share2 className="size-4" aria-hidden="true" />
      )}
      {isGenerating ? "生成中" : "分享当前图"}
    </Button>
  );
}
