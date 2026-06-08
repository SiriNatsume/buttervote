import Link from "next/link";
import { ImageIcon, Plus } from "lucide-react";
import { DeleteContestGroupDialog } from "@/components/delete-contest-group-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth";
import { getPublicImageUrl } from "@/lib/image/image-url";
import { createServerDataClient } from "@/lib/supabase/server-data";

export default async function AdminGroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireAdmin();
  const query = await searchParams;
  const supabase = await createServerDataClient();
  const [{ data: groups }, { data: contests }] = await Promise.all([
    supabase
      .from("contest_groups")
      .select(
        "id,name,description,cover_image_path,love_vote_weight,love_vote_quota,created_at",
      )
      .order("created_at", { ascending: false }),
    supabase.from("contests").select("id,group_id"),
  ]);
  const contestCountByGroup = new Map<string, number>();

  for (const contest of contests ?? []) {
    if (!contest.group_id) {
      continue;
    }

    contestCountByGroup.set(
      contest.group_id,
      (contestCountByGroup.get(contest.group_id) ?? 0) + 1,
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-normal">活动组</h1>
          <p className="mt-3 text-muted-foreground">
            管理组内活动和真爱票设置。
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
          <Button asChild variant="outline">
            <Link href="/admin">返回后台</Link>
          </Button>
          <Button asChild>
            <Link href="/admin/groups/new">
              <Plus className="size-4" />
              新建活动组
            </Link>
          </Button>
        </div>
      </div>

      {query.error ? (
        <div className="mb-6 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {query.error}
        </div>
      ) : null}

      {groups && groups.length > 0 ? (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {groups.map((group) => {
            const imageUrl = getPublicImageUrl(group.cover_image_path);

            return (
              <Card key={group.id} className="overflow-hidden">
                <div className="p-3 pb-0">
                  <div className="aspect-video overflow-hidden rounded-xl bg-muted">
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
                <CardHeader className="p-4 sm:p-6">
                  <CardTitle className="break-words">{group.name}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 p-4 pt-0 sm:p-6 sm:pt-0">
                  <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">
                    {group.description || "暂无简介。"}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">
                      {contestCountByGroup.get(group.id) ?? 0} 个活动
                    </Badge>
                    <Badge variant="love">
                      真爱票 x{Number(group.love_vote_weight)}
                    </Badge>
                    <Badge variant="outline">额度 {group.love_vote_quota}</Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Button asChild size="sm" className="w-full">
                      <Link href={`/admin/groups/${group.id}`}>打开</Link>
                    </Button>
                    <Button asChild size="sm" variant="outline" className="w-full">
                      <Link href={`/admin/groups/${group.id}/edit`}>编辑</Link>
                    </Button>
                    <DeleteContestGroupDialog
                      groupId={group.id}
                      triggerLabel="删除"
                      triggerClassName="w-full"
                    />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border p-8 text-muted-foreground">
          暂无活动组。新建活动组后，可以集中管理组内投票和真爱票设置。
        </div>
      )}
    </div>
  );
}
