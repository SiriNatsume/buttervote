import { ImageIcon } from "lucide-react";
import type { Candidate } from "@/lib/types";
import { getPublicImageUrl } from "@/lib/image/image-url";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type CandidateCardCandidate = Pick<
  Candidate,
  "id" | "name" | "description" | "image_path" | "nominator_display_name"
>;

export function CandidateCard({
  candidate,
  showImage = true,
  showDescription = true,
  showNominatorInfo = true,
}: {
  candidate: CandidateCardCandidate;
  showImage?: boolean;
  showDescription?: boolean;
  showNominatorInfo?: boolean;
}) {
  const imageUrl = getPublicImageUrl(candidate.image_path);

  return (
    <Card className="transition hover:border-orange-200 hover:shadow-md">
      <div className="flex gap-4 p-4">
        {showImage ? (
          <div className="size-24 shrink-0 overflow-hidden rounded-2xl bg-muted sm:size-28">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={`${candidate.name} 图片`}
                className="size-full object-cover"
              />
            ) : (
              <div className="butter-placeholder flex size-full items-center justify-center">
                <ImageIcon className="size-7" aria-hidden="true" />
              </div>
            )}
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          <CardHeader className="p-0 pb-3">
            <CardTitle className="text-base leading-snug">
              {candidate.name}
            </CardTitle>
          </CardHeader>
          {showDescription ? (
            <CardContent className="p-0">
              <p className="text-sm leading-6 text-muted-foreground">
                {candidate.description || "暂无简介。"}
              </p>
            </CardContent>
          ) : null}
          {showNominatorInfo && candidate.nominator_display_name ? (
            <div className="mt-3 space-y-1 text-xs leading-5 text-muted-foreground">
              <p>提名者：{candidate.nominator_display_name}</p>
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
