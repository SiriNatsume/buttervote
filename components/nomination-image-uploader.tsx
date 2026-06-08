"use client";

import Link from "next/link";
import { useState } from "react";
import { updateNominationImageAction } from "@/lib/actions/nomination-actions";
import { Button } from "@/components/ui/button";
import { ImageCropUpload } from "@/components/image-crop-upload";

type ImageValue = {
  imagePath?: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  imageSize?: number | null;
};

export function NominationImageUploader({
  contestId,
  nominationId,
  value,
  showActions = true,
  disabled = false,
}: {
  contestId: string;
  nominationId: string;
  value?: ImageValue;
  showActions?: boolean;
  disabled?: boolean;
}) {
  const [currentValue, setCurrentValue] = useState<ImageValue | undefined>(
    value,
  );
  const [uploaded, setUploaded] = useState(Boolean(value?.imagePath));

  return (
    <div className="space-y-4">
      <ImageCropUpload
        mode="candidate-image"
        storagePath={`nominations/${nominationId}/image.webp`}
        value={currentValue}
        disabled={disabled}
        onUploaded={async (result) => {
          const response = await updateNominationImageAction(nominationId, {
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
        setUploaded(true);
      }}
    />
      {showActions ? (
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href={`/contests/${contestId}`}>返回活动</Link>
          </Button>
          {!uploaded ? (
            <Button asChild variant="outline">
              <Link href={`/contests/${contestId}`}>稍后上传</Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
