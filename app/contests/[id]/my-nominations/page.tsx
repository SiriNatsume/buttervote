import Link from "next/link";
import { ActivityBreadcrumb } from "@/components/activity-breadcrumb";
import { notFound } from "next/navigation";
import { ArrowLeft, ClipboardList, Send } from "lucide-react";
import { StatusBadge } from "@/components/contest-badges";
import {
  MyNominationsGroupedList,
  type MyNominationItem,
} from "@/components/my-nominations-grouped-list";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { canParticipateContestGroup } from "@/lib/permissions/user-groups";
import { applyDueScheduledTransitionsForContest } from "@/lib/scheduled-transitions";
import { createClient } from "@/lib/supabase/server";
import { createServerDataClient } from "@/lib/supabase/server-data";
import type { ContestStatus, NominationStatus } from "@/lib/types";

export const metadata = { title: "我的提名 | Butter Vote" };

export default async function ContestMyNominationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser(`/contests/${id}/my-nominations`);
  await applyDueScheduledTransitionsForContest(id, { revalidate: false });
  const supabase = await createClient();
  const { data: contest } = await supabase
    .from("contests")
    .select(
      "id,title,status,group_id,max_nominations_per_user,candidate_description_max_length,nomination_image_required,archived_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (!contest || contest.archived_at) {
    notFound();
  }

  const dataClient = await createServerDataClient();
  const { data: nominations, error } = await dataClient
    .from("nominations")
    .select(
      "id,contest_id,name,description,status,rejection_reason,rejected_at,created_at,image_path,image_width,image_height,image_size,nominator_display_name",
    )
    .eq("contest_id", contest.id)
    .eq("submitter_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to load personal contest nominations.", error.message);
    throw new Error("暂时无法读取你的提名，请稍后再试。");
  }

  const nominationItems: MyNominationItem[] = (nominations ?? []).map((item) => ({
    ...item,
    status: item.status as NominationStatus,
    contest: {
      id: contest.id,
      title: contest.title,
      status: contest.status as ContestStatus,
      candidate_description_max_length: contest.candidate_description_max_length,
      nomination_image_required: contest.nomination_image_required === true,
    },
  }));
  const isAdmin = user.role === "admin";
  const nominationOpen =
    contest.status === "nominating" ||
    (isAdmin && contest.status === "admin_nominating");
  const canParticipate = contest.group_id
    ? await canParticipateContestGroup({
        contestGroupId: contest.group_id,
        profile: user,
      })
    : true;
  const activeCount = nominationItems.filter(
    (item) => item.status !== "rejected",
  ).length;
  const limitReached =
    !isAdmin &&
    contest.max_nominations_per_user !== null &&
    activeCount >= contest.max_nominations_per_user;
  const canContinue = nominationOpen && canParticipate && !limitReached;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      <ActivityBreadcrumb contest={contest} current="我的提名" />
      <nav
        aria-label="我的提名导航"
        className="mb-6 flex flex-wrap items-center justify-between gap-2"
      >
        <Button asChild variant="ghost">
          <Link href={`/contests/${contest.id}`}>
            <ArrowLeft className="size-4" />返回活动
          </Link>
        </Button>
        <Button asChild variant="view">
          <Link href="/me/nominations">
            <ClipboardList className="size-4" />全部活动的提名
          </Link>
        </Button>
      </nav>

      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Link
              href={`/contests/${contest.id}`}
              className="break-words underline-offset-4 hover:text-primary hover:underline"
            >
              {contest.title}
            </Link>
            <StatusBadge status={contest.status as ContestStatus} />
          </div>
          <h1
            id="contest-my-nominations-heading"
            tabIndex={-1}
            className="text-3xl font-semibold tracking-normal"
          >
            我的提名
          </h1>
          <p className="mt-3 text-muted-foreground">
            查看你在本活动中的提名、审核状态与拒绝理由。
          </p>
        </div>
        {canContinue ? (
          <Button
            asChild
            variant="nomination"
            className="self-start sm:shrink-0"
          >
            <Link href={`/contests/${contest.id}/nominate`}>
              <Send className="size-4" />
              {nominationItems.length ? "继续提名" : "去提名"}
            </Link>
          </Button>
        ) : null}
      </div>

      {nominationOpen && (!canParticipate || limitReached) ? (
        <p className="mb-6 text-sm text-muted-foreground">
          {!canParticipate
            ? "你暂时没有本活动的提名权限，仍可查看已提交的记录。"
            : "你在该活动中的提名数量已达上限。"}
        </p>
      ) : null}

      <MyNominationsGroupedList
        nominations={nominationItems}
        groupByContest={false}
        emptyMessage={
          canContinue
            ? "你还没有在本活动中提交提名，可以点击“去提名”提交第一个候选项。"
            : "你还没有在本活动中提交过提名。"
        }
      />
    </div>
  );
}
