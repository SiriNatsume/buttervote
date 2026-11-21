import { ImageIcon } from "lucide-react";
import { VoteImage } from "@/components/vote-image";
import { getPublicImageUrl } from "@/lib/image/image-url";
import type { Candidate } from "@/lib/types";
import { cn } from "@/lib/utils";

export function VoteCandidateThumb({
  candidate,
  show,
  compact = false,
  className,
}: {
  candidate: Pick<Candidate, "name" | "image_path">;
  show: boolean;
  compact?: boolean;
  className?: string;
}) {
  if (!show) return null;
  const imageUrl = getPublicImageUrl(candidate.image_path);

  return (
    <span className={cn("flex shrink-0 items-center justify-center overflow-hidden bg-muted", compact ? "size-11 rounded-lg" : "size-16 rounded-xl", className)}>
      {imageUrl ? (
        <VoteImage
          src={imageUrl}
          alt={compact ? "" : `${candidate.name} 图片`}
          maxWidth={compact ? 128 : 256}
          sizes={compact ? "44px" : "64px"}
          loading="lazy"
          className="size-full object-cover"
        />
      ) : (
        <span className="butter-placeholder flex size-full items-center justify-center">
          <ImageIcon className="size-5" aria-hidden="true" />
        </span>
      )}
    </span>
  );
}
