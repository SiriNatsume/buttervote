import Link from "next/link";
import { ArrowRight, ImageIcon } from "lucide-react";
import type { ContestGroup } from "@/lib/types";
import { getPublicImageUrl } from "@/lib/image/image-url";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type ContestGroupCardGroup = Pick<
  ContestGroup,
  "id" | "name" | "description" | "cover_image_path"
>;

export function ContestGroupCard({
  group,
  contestCount,
}: {
  group: ContestGroupCardGroup;
  contestCount: number;
}) {
  const imageUrl = getPublicImageUrl(group.cover_image_path);

  return (
    <Card className="flex h-full flex-col overflow-hidden transition hover:border-orange-200 hover:shadow-md">
      <div className="p-3 pb-0">
        <div className="aspect-video overflow-hidden rounded-2xl bg-muted">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={`${group.name} 封面`}
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
          <Badge variant="outline" className="border-orange-200 bg-orange-50 text-orange-800">
            活动组
          </Badge>
          <Badge variant="outline" className="border-[#DFC28E] bg-white/50 text-[#6A4A2B]">
            {contestCount} 个活动
          </Badge>
        </div>
        <CardTitle className="leading-snug">{group.name}</CardTitle>
      </CardHeader>
      <CardContent className="flex-1">
        <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">
          {group.description || "暂无简介。"}
        </p>
      </CardContent>
      <CardFooter>
        <Button asChild className="w-full">
          <Link href={`/groups/${group.id}`}>
            查看活动组
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
