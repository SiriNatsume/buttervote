import Link from "next/link";
import { notFound } from "next/navigation";
import { BarChart3, ImageIcon, Send, Trophy } from "lucide-react";
import { ContestCard } from "@/components/contest-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { canNominateByStatus, canViewResults } from "@/lib/contest-rules";
import { getCurrentProfile } from "@/lib/auth";
import { getPublicImageUrl } from "@/lib/image/image-url";
import { canParticipateContestGroup } from "@/lib/permissions/user-groups";
import { applyScheduledTransitions } from "@/lib/scheduled-transitions";
import { createClient } from "@/lib/supabase/server";
import { createServerDataClient } from "@/lib/supabase/server-data";

export default async function GroupDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await applyScheduledTransitions({ revalidate: false });
  const supabase = await createClient();
  const [{ data: group }, { data: contests }, profile] = await Promise.all([
    supabase
      .from("contest_groups")
      .select("id,name,description,cover_image_path,access_mode")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("contests")
      .select(
        "id,title,description,status,vote_type,image_path,max_nominations_per_user,closed_result_visibility,live_results_enabled",
      )
      .eq("group_id", id)
      .is("archived_at", null)
      .neq("status", "draft")
      .order("created_at", { ascending: true }),
    getCurrentProfile(),
  ]);

  if (!group) {
    notFound();
  }

  const visibleContests = contests ?? [];
  const coverUrl = getPublicImageUrl(group.cover_image_path);
  const isAdmin = profile?.role === "admin";
  const isRestricted = group.access_mode === "restricted";
  const canParticipate = isRestricted
    ? await canParticipateContestGroup({
        contestGroupId: group.id,
        profile,
      })
    : Boolean(profile);
  const hasVotingContest = visibleContests.some(
    (contest) => contest.status === "voting",
  );
  const hasResultsContest = visibleContests.some((contest) =>
    canViewResults(contest, profile),
  );
  const hasVotingEntry = hasVotingContest && (!isRestricted || canParticipate);
  let nominatableContests = visibleContests.filter((contest) =>
    canNominateByStatus(contest, profile),
  );

  if (profile && !isAdmin && nominatableContests.length > 0) {
    const limitedContestIds = nominatableContests
      .filter((contest) => contest.max_nominations_per_user !== null)
      .map((contest) => contest.id);

    if (limitedContestIds.length > 0) {
      const dataClient = await createServerDataClient();
      const { data: ownNominations } = await dataClient
        .from("nominations")
        .select("contest_id")
        .eq("submitter_id", profile.id)
        .neq("status", "rejected")
        .in("contest_id", limitedContestIds);
      const nominationCountByContest = new Map<string, number>();

      for (const nomination of ownNominations ?? []) {
        nominationCountByContest.set(
          nomination.contest_id,
          (nominationCountByContest.get(nomination.contest_id) ?? 0) + 1,
        );
      }

      nominatableContests = nominatableContests.filter((contest) => {
        if (contest.max_nominations_per_user === null) {
          return true;
        }

        return (
          (nominationCountByContest.get(contest.id) ?? 0) <
          contest.max_nominations_per_user
        );
      });
    }
  }

  const hasNominationContest = nominatableContests.length > 0;
  const hasNominationEntry =
    hasNominationContest && (!isRestricted || canParticipate);
  const noVotingPermission = isRestricted && hasVotingContest && !canParticipate;
  const noNominationPermission =
    isRestricted && hasNominationContest && !canParticipate;
  const hasAnyEntry =
    hasNominationEntry || hasVotingEntry || hasResultsContest;

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <div className="mb-8 overflow-hidden rounded-3xl border border-[#EED8AA]/70 bg-[#FFFCF4]/90 shadow-sm">
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
        <div className="flex flex-col justify-between gap-6 p-8 md:flex-row md:items-end">
          <div>
            <h1 className="text-3xl font-semibold tracking-normal">
              {group.name}
            </h1>
            <p className="mt-4 max-w-3xl leading-7 text-muted-foreground">
              {group.description || "暂无简介。"}
            </p>
            {isRestricted ? (
              <div className="mt-4 space-y-2">
                <Badge variant="love">限定用户组</Badge>
                {!profile ? (
                  <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                    该活动组仅限指定用户组成员参与提名和投票，请通过 QQ bot
                    专属链接登录。
                  </p>
                ) : canParticipate ? (
                  <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                    你已拥有该活动组参与权限。
                  </p>
                ) : (
                  <div className="max-w-3xl text-sm leading-6 text-muted-foreground">
                    {noVotingPermission ? (
                      <p>你暂时没有参与该活动组投票的权限。</p>
                    ) : null}
                    {noNominationPermission ? (
                      <p>你暂时没有参与该活动组提名的权限。</p>
                    ) : null}
                    {!noVotingPermission && !noNominationPermission ? (
                      <p>你暂时没有参与该活动组的权限。</p>
                    ) : null}
                    <p>如果你是相关 QQ 群成员，请通过对应 QQ bot 链接重新验证。</p>
                  </div>
                )}
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-3 md:justify-end">
            {hasNominationEntry ? (
              <Button asChild size="lg" variant="secondary">
                <Link href={`/groups/${group.id}/nominate`}>
                  <Send className="size-4" />
                  参与组内提名
                </Link>
              </Button>
            ) : null}
            {hasVotingEntry ? (
              <Button asChild size="lg">
                <Link href={`/groups/${group.id}/vote`}>
                  <BarChart3 className="size-4" />
                  参与组内投票
                </Link>
              </Button>
            ) : null}
            {hasResultsContest ? (
              <Button asChild size="lg" variant="outline">
                <Link href={`/groups/${group.id}/results`}>
                  <Trophy className="size-4" />
                  查询组内结果
                </Link>
              </Button>
            ) : null}
            {!hasAnyEntry ? (
              <div className="rounded-2xl border border-[#EED8AA]/70 bg-white/60 px-4 py-3 text-sm text-muted-foreground">
                当前活动组暂无可参与的阶段。
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-xl font-semibold">活动</h2>
        <span className="text-sm text-muted-foreground">
          {visibleContests.length}
        </span>
      </div>

      {visibleContests.length > 0 ? (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {visibleContests.map((contest) => (
            <ContestCard key={contest.id} contest={contest} />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border p-8 text-muted-foreground">
          该活动组暂无公开活动。活动发布后会在这里展示。
        </div>
      )}
    </div>
  );
}
