import Link from "next/link";
import { FolderKanban, Home, Trophy, UsersRound } from "lucide-react";
import {
  AdminContestsGroupedList,
  type AdminContestItem,
  type AdminGroupItem,
} from "@/components/admin-contests-grouped-list";
import { ContestForm } from "@/components/contest-form";
import { NominationReviewTable } from "@/components/nomination-review-table";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth";
import { applyScheduledTransitions } from "@/lib/scheduled-transitions";
import { createServerDataClient } from "@/lib/supabase/server-data";
import type { ContestStatus, VoteType } from "@/lib/types";
// import { createRequiredServiceClient } from "@/lib/supabase/service";


export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireAdmin();
  const query = await searchParams;
  await applyScheduledTransitions({ revalidate: false });
  const supabase = await createServerDataClient();
  const [{ data: contests }, { data: nominations }, { data: groups }] =
    await Promise.all([
      supabase
        .from("contests")
        .select("id,title,description,status,vote_type,max_choices,image_path,group_id,created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("nominations")
        .select(
          "id,contest_id,submitter_id,name,description,status,image_path,image_width,image_height,image_size,nominator_display_name,nominator_note,rejection_reason,rejected_at,created_at,updated_at, contests(title)",
        )
        .eq("status", "pending")
        .order("created_at", { ascending: true }),
      supabase
        .from("contest_groups")
        .select("id,name")
        .order("created_at", { ascending: false }),
    ]);

  const contestItems: AdminContestItem[] = (contests ?? []).map((contest) => ({
    id: contest.id,
    title: contest.title,
    description: contest.description,
    status: contest.status as ContestStatus,
    vote_type: contest.vote_type as VoteType,
    max_choices: contest.max_choices,
    image_path: contest.image_path,
    group_id: contest.group_id,
    created_at: contest.created_at,
  }));
  const groupItems: AdminGroupItem[] = (groups ?? []).map((group) => ({
    id: group.id,
    name: group.name,
  }));
  const submitterIds = [
    ...new Set(
      (nominations ?? [])
        .map((nomination) => nomination.submitter_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const { data: nominationProfiles } =
    submitterIds.length > 0
      ? await supabase
          .from("profiles")
          .select("id,display_name,email,qq_nickname,qq_user_id,login_provider")
          .in("id", submitterIds)
      : { data: [] };
  const profileById = new Map(
    (nominationProfiles ?? []).map((profile) => [profile.id, profile]),
  );
  const nominationsWithProfiles = (nominations ?? []).map((nomination) => ({
    ...nomination,
    profiles: nomination.submitter_id
      ? profileById.get(nomination.submitter_id) ?? null
      : null,
  }));

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-normal">管理后台</h1>
          <p className="mt-3 text-muted-foreground">
            管理活动、活动组、提名审核和首页展示。
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
          <Button asChild variant="outline">
            <Link href="/admin/groups">
              <FolderKanban className="size-4" />
              活动组
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin/user-groups">
              <UsersRound className="size-4" />
              用户组
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin/tournaments">
              <Trophy className="size-4" />
              赛制工具
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin/homepage">
              <Home className="size-4" />
              首页
            </Link>
          </Button>
          <ContestForm groups={groups ?? []} triggerClassName="col-span-2 w-full sm:col-span-1 sm:w-auto" />
        </div>
      </div>

      {query.error ? (
        <div className="mb-6 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {query.error}
        </div>
      ) : null}

      <Card className="mb-8">
        <CardHeader>
          <CardTitle>活动</CardTitle>
        </CardHeader>
        <CardContent className="p-4 sm:p-6">
          <AdminContestsGroupedList
            contests={contestItems}
            groups={groupItems}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>待审核提名</CardTitle>
        </CardHeader>
        <CardContent>
          <NominationReviewTable nominations={nominationsWithProfiles} />
        </CardContent>
      </Card>
    </div>
  );
}
