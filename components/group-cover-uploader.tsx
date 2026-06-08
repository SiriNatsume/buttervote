"use client";

import { useState } from "react";
import { updateGroupImageAction } from "@/lib/actions/admin-actions";
import { ImageCropUpload } from "@/components/image-crop-upload";

type ImageValue = {
  imagePath?: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  imageSize?: number | null;
};

export function GroupCoverUploader({
  groupId,
  value,
}: {
  groupId: string;
  value?: ImageValue;
}) {
  const [currentValue, setCurrentValue] = useState<ImageValue | undefined>(
    value,
  );

  return (
    <ImageCropUpload
      mode="contest-cover"
      storagePath={`groups/${groupId}/cover.webp`}
      value={currentValue}
      onUploaded={async (result) => {
        const response = await updateGroupImageAction(groupId, {
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
