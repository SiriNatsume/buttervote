"use client";

import { useState } from "react";
import { ImagePlus } from "lucide-react";
import { updateApprovedNominationImage } from "@/lib/actions/nomination-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ImageCropUpload } from "@/components/image-crop-upload";

export function ApprovedNominationImageUploader({
  nominationId,
}: {
  nominationId: string;
}) {
  const [open, setOpen] = useState(false);
  const [uploaded, setUploaded] = useState(false);

  if (uploaded) {
    return (
      <div className="text-sm text-muted-foreground">
        图片已补充，刷新后可查看最新预览。
      </div>
    );
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="w-full sm:w-auto"
        onClick={() => setOpen(true)}
      >
        <ImagePlus className="size-4" />
        补充图片
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>补充图片</DialogTitle>
            <DialogDescription>
              已通过但尚未上传图片的提名，可以在这里补充一次候选项图片。
            </DialogDescription>
          </DialogHeader>
          <ImageCropUpload
            mode="candidate-image"
            storagePath={`nominations/${nominationId}/image.jpg`}
            onUploaded={async (result) => {
              const response = await updateApprovedNominationImage(nominationId, {
                imagePath: result.imagePath,
                imageWidth: result.imageWidth,
                imageHeight: result.imageHeight,
                imageSize: result.imageSize,
              });

              if (!response.ok) {
                throw new Error(response.error);
              }

              setUploaded(true);
              setOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
