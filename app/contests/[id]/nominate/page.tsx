import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canParticipateContestGroup } from "@/lib/permissions/user-groups";
import { createServerDataClient } from "@/lib/supabase/server-data";
import { ExistingNominationsList } from "@/components/existing-nominations-list";
import { GroupAccessDeniedPanel } from "@/components/group-access-denied-panel";
import { NominationCreateForm } from "@/components/nomination-create-form";
import { NominationImageUploader } from "@/components/nomination-image-uploader";
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
  const user = await requireUser();
  const [{ id }, query] = await Promise.all([
    params,
    searchParams,
  ]);
  const supabase = await createServerDataClient();
  const { data: contest } = await supabase
    .from("contests")
    .select(
      "id,title,status,group_id,max_nominations_per_user,show_existing_nominations,show_nominator_info,candidate_description_max_length",
    )
    .eq("id", id)
    .maybeSingle();

  const isAdmin = user.role === "admin";
  const canNominate =
    contest?.status === "nominating" ||
    (contest?.status === "admin_nominating" && isAdmin);

  if (!contest || !canNominate) {
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
          <GroupAccessDeniedPanel
            actionLabel="提名"
            backHref={`/contests/${contest.id}`}
          />
        </div>
      );
    }
  }

  let nominationLimitError: string | null = null;

  const canViewExistingNominations =
    isAdmin || contest.show_existing_nominations === true;
  const { data: existingNominations } = canViewExistingNominations
    ? await supabase
        .from("nominations")
        .select("id,name,description,status,nominator_display_name,created_at")
        .eq("contest_id", contest.id)
        .order("created_at", { ascending: true })
    : { data: [] };

  if (!isAdmin && contest.max_nominations_per_user !== null) {
    const { count } = await supabase
      .from("nominations")
      .select("id", { count: "exact", head: true })
      .eq("contest_id", contest.id)
      .eq("submitter_id", user.id)
      .neq("status", "rejected");

    if ((count ?? 0) >= contest.max_nominations_per_user && !query.nominationId) {
      nominationLimitError = "你在该活动中的提名数量已达上限。";
    }
  }

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
      .maybeSingle();
    nomination = data;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-12 sm:px-6">
      {nomination ? (
        <Card>
          <CardHeader>
            <CardTitle>上传提名图片</CardTitle>
            <CardDescription>{contest.title}</CardDescription>
          </CardHeader>
          <CardContent>
            <NominationImageUploader
              contestId={contest.id}
              nominationId={nomination.id}
              value={{
                imagePath: nomination.image_path,
                imageWidth: nomination.image_width,
                imageHeight: nomination.image_height,
                imageSize: nomination.image_size,
              }}
            />
          </CardContent>
        </Card>
      ) : nominationLimitError ? (
        <Card>
          <CardHeader>
            <CardTitle>无法继续提名</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {nominationLimitError}
            </div>
          </CardContent>
        </Card>
      ) : (
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
              contestId={contest.id}
              descriptionMaxLength={contest.candidate_description_max_length}
              existingNominations={existingNominations ?? []}
              showNominatorInfo={contest.show_nominator_info !== false}
            />
          </CardContent>
        </Card>
      )}
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
