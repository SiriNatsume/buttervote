import { requireUser } from "@/lib/auth";
import { createServerDataClient } from "@/lib/supabase/server-data";
import {
  MyNominationsGroupedList,
  type MyNominationItem,
} from "@/components/my-nominations-grouped-list";
import type { ContestStatus, NominationStatus } from "@/lib/types";

export default async function MyNominationsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const user = await requireUser();
  const query = await searchParams;
  const supabase = await createServerDataClient();
  const { data: nominations } = await supabase
    .from("nominations")
    .select(
      "id,contest_id,name,description,status,rejection_reason,rejected_at,created_at,image_path,image_width,image_height,image_size,nominator_display_name, contests(id,title,status,candidate_description_max_length,nomination_image_required)",
    )
    .eq("submitter_id", user.id)
    .order("created_at", { ascending: false });

  const nominationItems: MyNominationItem[] = (nominations ?? []).map(
    (nomination) => {
      const contest = nomination.contests as
        | {
            id: string;
            title: string;
            status: ContestStatus;
            candidate_description_max_length: number | null;
            nomination_image_required: boolean | null;
          }
        | null
        | undefined;

      return {
        id: nomination.id,
        contest_id: nomination.contest_id,
        name: nomination.name,
        description: nomination.description,
        status: nomination.status as NominationStatus,
        rejection_reason: nomination.rejection_reason,
        rejected_at: nomination.rejected_at,
        created_at: nomination.created_at,
        image_path: nomination.image_path,
        image_width: nomination.image_width,
        image_height: nomination.image_height,
        image_size: nomination.image_size,
        nominator_display_name: nomination.nominator_display_name,
        contest: contest
          ? {
              id: contest.id,
              title: contest.title,
              status: contest.status,
              candidate_description_max_length:
                contest.candidate_description_max_length,
              nomination_image_required:
                contest.nomination_image_required === true,
            }
          : null,
      };
    },
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="mb-8">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-normal">我的提名</h1>
          <p className="mt-3 text-muted-foreground">
            你可以修改待审核或已拒绝的提名；已通过审核的提名不可再修改。
          </p>
        </div>
      </div>

      {query.error ? (
        <div className="mb-6 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {query.error}
        </div>
      ) : null}

      {query.saved ? (
        <div className="mb-6 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary">
          已保存并重新提交审核。
        </div>
      ) : null}

      <MyNominationsGroupedList nominations={nominationItems} />
    </div>
  );
}
