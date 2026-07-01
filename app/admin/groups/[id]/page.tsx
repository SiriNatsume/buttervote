import Link from "next/link";
import { notFound } from "next/navigation";
import { ImageIcon, Pencil } from "lucide-react";
import { ArchiveContestDialog } from "@/components/archive-contest-dialog";
import { DeleteContestGroupDialog } from "@/components/delete-contest-group-dialog";
import { ContestForm } from "@/components/contest-form";
import { GroupContestSettingsBatchPanel } from "@/components/group-contest-settings-batch-panel";
import { GroupScheduleBatchPanel } from "@/components/group-schedule-batch-panel";
import { InheritCandidatesForm } from "@/components/inherit-candidates-form";
import { StatusBadge, VoteTypeBadge } from "@/components/contest-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth";
import { getPublicImageUrl } from "@/lib/image/image-url";
import { createServerDataClient } from "@/lib/supabase/server-data";

export default async function AdminGroupDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; inherited?: string }>;
}) {
  await requireAdmin();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const supabase = await createServerDataClient();
  const [{ data: group }, { data: contests }] = await Promise.all([
    supabase
      .from("contest_groups")
      .select(
        "id,name,description,cover_image_path,love_vote_weight,love_vote_quota",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("contests")
      .select(
        "id,title,status,vote_type,max_choices,love_vote_enabled,live_results_enabled,voting_starts_at,voting_ends_at,created_at",
      )
      .eq("group_id", id)
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);

  if (!group) {
    notFound();
  }

  const { data: candidates } =
    contests && contests.length > 0
      ? await supabase
          .from("candidates")
          .select("id,contest_id,name,description")
          .in(
            "contest_id",
            contests.map((contest) => contest.id),
          )
          .eq("is_active", true)
          .order("created_at", { ascending: true })
      : { data: [] };
  const coverUrl = getPublicImageUrl(group.cover_image_path);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="break-words text-3xl font-semibold tracking-normal">
            {group.name}
          </h1>
          <p className="mt-3 max-w-3xl text-muted-foreground">
            {group.description || "暂无简介。"}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
          <Button asChild variant="outline">
            <Link href="/admin/groups">全部活动组</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/admin/groups/${group.id}/edit`}>
              <Pencil className="size-4" />
              编辑活动组
            </Link>
          </Button>
          <Button asChild>
            <Link href={`/groups/${group.id}`}>打开公开页</Link>
          </Button>
          <DeleteContestGroupDialog
            groupId={group.id}
            triggerClassName="w-full sm:w-auto"
          />
        </div>
      </div>

      {query.error ? (
        <div className="mb-6 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {query.error}
        </div>
      ) : null}

      {query.inherited ? (
        <div className="mb-6 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary">
          已继承 {query.inherited} 个候选项。
        </div>
      ) : null}

      <div className="mb-6 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <Card className="overflow-hidden">
          <div className="aspect-video bg-muted">
            {coverUrl ? (
              <img
                src={coverUrl}
                alt={`${group.name} 封面`}
                className="size-full object-cover"
              />
            ) : (
              <div className="butter-placeholder flex size-full items-center justify-center">
                <ImageIcon className="size-10" aria-hidden="true" />
              </div>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>活动组设置</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant="love">
                真爱票 x{Number(group.love_vote_weight)}
              </Badge>
              <Badge variant="outline">额度 {group.love_vote_quota}</Badge>
              <Badge variant="secondary">{(contests ?? []).length} 个活动</Badge>
            </div>
            <ContestForm
              groups={[{ id: group.id, name: group.name }]}
              defaultGroupId={group.id}
              triggerLabel="在组内创建活动"
              triggerClassName="w-full sm:w-auto"
            />
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>批量状态与定时任务</CardTitle>
        </CardHeader>
        <CardContent className="p-4 sm:p-6">
          <GroupScheduleBatchPanel
            groupId={group.id}
            contests={(contests ?? []).map((contest) => ({
              id: contest.id,
              title: contest.title,
              status: contest.status,
              voting_starts_at: contest.voting_starts_at,
              voting_ends_at: contest.voting_ends_at,
            }))}
          />
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>批量投票设置</CardTitle>
        </CardHeader>
        <CardContent className="p-4 sm:p-6">
          <GroupContestSettingsBatchPanel
            groupId={group.id}
            contests={(contests ?? []).map((contest) => ({
              id: contest.id,
              title: contest.title,
              love_vote_enabled: contest.love_vote_enabled,
              live_results_enabled: contest.live_results_enabled,
            }))}
          />
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>组内活动</CardTitle>
        </CardHeader>
        <CardContent className="p-4 sm:p-6">
          {contests && contests.length > 0 ? (
            <>
              <div className="space-y-3 md:hidden">
                {contests.map((contest) => (
                  <div
                    key={contest.id}
                    className="rounded-2xl border border-[#EED8AA]/70 bg-[#FFFCF4]/85 p-4 shadow-sm"
                  >
                    <h3 className="break-words font-semibold leading-snug">
                      {contest.title}
                    </h3>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <StatusBadge status={contest.status} />
                      <VoteTypeBadge voteType={contest.vote_type} />
                    </div>
                    <div className="mt-3 rounded-xl bg-[#FFF8E8]/70 px-3 py-2 text-sm text-muted-foreground">
                      最多可选：{contest.max_choices}
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <Button asChild size="sm" variant="outline" className="w-full">
                        <Link href={`/admin/contests/${contest.id}/edit`}>
                          编辑
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="outline" className="w-full">
                        <Link href={`/contests/${contest.id}`}>打开</Link>
                      </Button>
                      <ArchiveContestDialog
                        contestId={contest.id}
                        contestTitle={contest.title}
                        triggerSize="sm"
                        triggerClassName="w-full"
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="hidden rounded-2xl border border-[#EED8AA]/70 md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>标题</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>类型</TableHead>
                      <TableHead>最多可选</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {contests.map((contest) => (
                      <TableRow key={contest.id}>
                        <TableCell className="font-medium">
                          {contest.title}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={contest.status} />
                        </TableCell>
                        <TableCell>
                          <VoteTypeBadge voteType={contest.vote_type} />
                        </TableCell>
                        <TableCell>{contest.max_choices}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button asChild size="sm" variant="outline">
                              <Link href={`/admin/contests/${contest.id}/edit`}>
                                编辑
                              </Link>
                            </Button>
                            <Button asChild size="sm" variant="outline">
                              <Link href={`/contests/${contest.id}`}>打开</Link>
                            </Button>
                            <ArchiveContestDialog
                              contestId={contest.id}
                              contestTitle={contest.title}
                              triggerSize="sm"
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          ) : (
            <div className="rounded-2xl border p-6 text-sm text-muted-foreground">
              该活动组暂无活动。可以先在组内创建活动，再配置批量状态和定时任务。
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>继承候选项</CardTitle>
        </CardHeader>
        <CardContent>
          {contests && contests.length > 1 ? (
            <InheritCandidatesForm
              contests={contests.map((contest) => ({
                id: contest.id,
                title: contest.title,
              }))}
              candidates={candidates ?? []}
              returnTo={`/admin/groups/${group.id}`}
            />
          ) : (
            <div className="rounded-2xl border p-5 text-sm text-muted-foreground">
              至少创建两个组内活动后，可以在活动之间继承候选项。
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
