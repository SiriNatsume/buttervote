import Link from "next/link";
import { ActivityBreadcrumb } from "@/components/activity-breadcrumb";
import { redirect } from "next/navigation";
import { ArrowLeft, ClipboardList } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { canParticipateContestGroup } from "@/lib/permissions/user-groups";
import { createServerDataClient } from "@/lib/supabase/server-data";
import { ExistingNominationsList } from "@/components/existing-nominations-list";
import { GroupAccessDeniedPanel } from "@/components/group-access-denied-panel";
import { NominationCreateForm } from "@/components/nomination-create-form";
import { NominationImageUploader } from "@/components/nomination-image-uploader";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function NominatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; nominationId?: string }>;
}) {
  const [{ id }, query] = await Promise.all([
    params,
    searchParams,
  ]);
  const user = await requireUser(`/contests/${id}/nominate${query.nominationId ? `?nominationId=${encodeURIComponent(query.nominationId)}` : ""}`);
  const supabase = await createServerDataClient();
  const { data: contest } = await supabase
    .from("contests")
    .select(
      "id,title,status,group_id,max_nominations_per_user,show_existing_nominations,show_nominator_info,candidate_description_max_length,nomination_image_required,archived_at",
    )
    .eq("id", id)
    .maybeSingle();

  const isAdmin = user.role === "admin";
  const canNominate =
    contest?.status === "nominating" ||
    (contest?.status === "admin_nominating" && isAdmin);

  if (!contest || contest.archived_at || !canNominate) {
    redirect(`/contests/${id}`);
  }

  if (contest.group_id) {
    const canParticipate = await canParticipateContestGroup({
      contestGroupId: contest.group_id,
      profile: user,
    });

    if (!canParticipate) {
      return (
        <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
          <ActivityBreadcrumb contest={contest} current="参与提名" />
          <GroupAccessDeniedPanel
            actionLabel="提名"
            backHref={`/contests/${contest.id}`}
          />
        </div>
      );
    }
  }

  const canViewExistingNominations =
    isAdmin || contest.show_existing_nominations === true;
  const { data: existingNominations } = canViewExistingNominations
    ? await supabase
        .from("nominations")
        .select("id,name,description,status,nominator_display_name,created_at")
        .eq("contest_id", contest.id)
        .neq("status", "draft")
        .order("created_at", { ascending: true })
    : { data: [] };

  const { data: ownNominations, count: ownNominationCount, error: ownNominationError } = await supabase
    .from("nominations")
    .select("id,status", { count: "exact" })
    .eq("contest_id", contest.id)
    .eq("submitter_id", user.id)
    .neq("status", "rejected");

  let nomination:
    | {
        id: string;
        image_path: string | null;
        image_width: number | null;
        image_height: number | null;
        image_size: number | null;
      }
    | null = null;

  if (query.nominationId) {
    const { data } = await supabase
      .from("nominations")
      .select("id,image_path,image_width,image_height,image_size")
      .eq("id", query.nominationId)
      .eq("contest_id", contest.id)
      .eq("submitter_id", user.id)
      .maybeSingle();
    nomination = data;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-12 sm:px-6">
      <ActivityBreadcrumb contest={contest} current="参与提名" className="mb-0" />
      <nav
        aria-label="提名导航"
        className="flex flex-wrap items-center justify-between gap-2"
      >
        <Button asChild variant="ghost">
          <Link href={`/contests/${contest.id}`}>
            <ArrowLeft className="size-4" />返回活动
          </Link>
        </Button>
        <Button asChild variant="view">
          <Link href={`/contests/${contest.id}/my-nominations`}>
            <ClipboardList className="size-4" />我的提名
          </Link>
        </Button>
      </nav>
      {nomination ? (
        <Card>
          <CardHeader>
            <CardTitle>上传提名图片</CardTitle>
            <CardDescription>
              {contest.nomination_image_required
                ? `${contest.title}：上传成功后会进入待审核。`
                : contest.title}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <NominationImageUploader
              contestId={contest.id}
              nominationId={nomination.id}
              showActions={false}
              value={{
                imagePath: nomination.image_path,
                imageWidth: nomination.image_width,
                imageHeight: nomination.image_height,
                imageSize: nomination.image_size,
              }}
            />
          </CardContent>
        </Card>
      ) : null}
        <Card>
          <CardHeader>
            <CardTitle>
              {contest.status === "admin_nominating"
                ? "管理员提名"
                : "提交提名"}
              ：{contest.title}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {query.error ? (
              <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {query.error}
              </div>
            ) : null}
            <NominationCreateForm
              key={`${user.id}:${contest.id}`}
              contestId={contest.id}
              userId={user.id}
              maxNominations={isAdmin ? null : contest.max_nominations_per_user}
              initialNominationCount={ownNominationCount ?? 0}
              submittedNominationIds={(ownNominations ?? []).filter((item) => item.status !== "draft").map((item) => item.id)}
              nominationCountError={ownNominationError ? "暂时无法读取提名名额，请刷新后重试。" : null}
              descriptionMaxLength={contest.candidate_description_max_length}
              imageRequired={contest.nomination_image_required === true}
              existingNominations={existingNominations ?? []}
              showNominatorInfo={contest.show_nominator_info !== false}
            />
          </CardContent>
        </Card>
      {canViewExistingNominations ? (
        <ExistingNominationsList
          nominations={existingNominations ?? []}
          showNominatorInfo={contest.show_nominator_info !== false}
          defaultOpen={false}
        />
      ) : null}
    </div>
  );
}
