"use client";

import { useState } from "react";
import { updateContestImageAction } from "@/lib/actions/admin-actions";
import { ImageCropUpload } from "@/components/image-crop-upload";

type ImageValue = {
  imagePath?: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  imageSize?: number | null;
};

export function ContestImageUploader({
  contestId,
  value,
}: {
  contestId: string;
  value?: ImageValue;
}) {
  const [currentValue, setCurrentValue] = useState<ImageValue | undefined>(
    value,
  );

  return (
    <ImageCropUpload
      mode="contest-cover"
      storagePath={`contests/${contestId}/cover.webp`}
      value={currentValue}
      onUploaded={async (result) => {
        const response = await updateContestImageAction(contestId, {
          imagePath: result.imagePath,
          imageWidth: result.imageWidth,
          imageHeight: result.imageHeight,
          imageSize: result.imageSize,
        });

        if (!response.ok) {
          throw new Error(response.error);
        }

        setCurrentValue({
          imagePath: result.imagePath,
          imageWidth: result.imageWidth,
          imageHeight: result.imageHeight,
          imageSize: result.imageSize,
        });
      }}
    />
  );
}
