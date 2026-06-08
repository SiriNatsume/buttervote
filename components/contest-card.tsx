import Link from "next/link";
import { ArrowRight, ImageIcon } from "lucide-react";
import type { Contest } from "@/lib/types";
import { statusLabel, voteTypeLabel } from "@/lib/contest-rules";
import { getPublicImageUrl } from "@/lib/image/image-url";
import { StatusBadge, VoteTypeBadge } from "@/components/contest-badges";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export { statusLabel, voteTypeLabel };

export type ContestCardContest = Pick<
  Contest,
  "id" | "title" | "description" | "status" | "vote_type" | "image_path"
>;

export function ContestCard({ contest }: { contest: ContestCardContest }) {
  const imageUrl = getPublicImageUrl(contest.image_path);

  return (
    <Card className="flex h-full flex-col overflow-hidden transition hover:border-orange-200 hover:shadow-md">
      <div className="p-3 pb-0">
        <div className="aspect-video overflow-hidden rounded-2xl bg-muted">
          {imageUrl ? (
              <img
                src={imageUrl}
              alt={`${contest.title} 封面`}
              className="size-full object-cover"
            />
          ) : (
            <div className="butter-placeholder flex size-full items-center justify-center">
              <ImageIcon className="size-8" aria-hidden="true" />
            </div>
          )}
        </div>
      </div>
      <CardHeader>
        <div className="mb-3 flex flex-wrap gap-2">
          <StatusBadge status={contest.status} />
          <VoteTypeBadge voteType={contest.vote_type} />
        </div>
        <CardTitle className="leading-snug">{contest.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex-1">
        <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">
          {contest.description || "暂无简介。"}
        </p>
      </CardContent>
      <CardFooter>
        <Button asChild className="w-full">
          <Link href={`/contests/${contest.id}`}>
            查看详情
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
