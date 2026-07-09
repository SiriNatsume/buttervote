import Link from "next/link";
import { notFound } from "next/navigation";
import { ImageIcon, LogIn, Send } from "lucide-react";
import { StatusBadge } from "@/components/contest-badges";
import { GroupAccessDeniedPanel } from "@/components/group-access-denied-panel";
import { MascotEmptyState } from "@/components/mascot";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { canNominateByStatus } from "@/lib/contest-rules";
import { getCurrentProfile } from "@/lib/auth";
import { getPublicImageUrl } from "@/lib/image/image-url";
import { canParticipateContestGroup } from "@/lib/permissions/user-groups";
import { applyScheduledTransitions } from "@/lib/scheduled-transitions";
import { createServerDataClient } from "@/lib/supabase/server-data";

export default async function GroupNominatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await applyScheduledTransitions({ revalidate: false });
  const [profile, supabase] = await Promise.all([
    getCurrentProfile(),
    createServerDataClient(),
  ]);
  const [{ data: group }, { data: contests }] = await Promise.all([
    supabase
      .from("contest_groups")
      .select("id,name,description,cover_image_path,access_mode")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("contests")
      .select(
        "id,title,description,status,max_nominations_per_user,nomination_image_required,created_at",
      )
      .eq("group_id", id)
      .is("archived_at", null)
      .neq("status", "draft")
      .order("updated_at", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);

  if (!group) {
    notFound();
  }

  const isRestricted = group.access_mode === "restricted";
  const canParticipate = isRestricted
    ? await canParticipateContestGroup({
        contestGroupId: group.id,
        profile,
      })
    : true;

  if (isRestricted && !canParticipate) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <GroupAccessDeniedPanel
          actionLabel="提名"
          backHref={`/groups/${group.id}`}
        />
      </div>
    );
  }

  const isAdmin = profile?.role === "admin";
  let nominatableContests = (contests ?? []).filter((contest) =>
    canNominateByStatus(contest, profile),
  );
  const contestIds = nominatableContests.map((contest) => contest.id);
  const [{ data: nominations }, { data: candidates }] =
    contestIds.length > 0
      ? await Promise.all([
          supabase
            .from("nominations")
            .select("contest_id,submitter_id,status")
            .in("contest_id", contestIds),
          supabase
            .from("candidates")
            .select("contest_id")
            .in("contest_id", contestIds)
            .eq("is_active", true),
        ])
      : [{ data: [] }, { data: [] }];
  const nominationCountByContest = new Map<string, number>();
  const candidateCountByContest = new Map<string, number>();
  const ownNominationCountByContest = new Map<string, number>();

  for (const nomination of nominations ?? []) {
    if (nomination.status !== "draft") {
      nominationCountByContest.set(
        nomination.contest_id,
        (nominationCountByContest.get(nomination.contest_id) ?? 0) + 1,
      );
    }

    if (
      profile &&
      nomination.submitter_id === profile.id &&
      nomination.status !== "rejected"
    ) {
      ownNominationCountByContest.set(
        nomination.contest_id,
        (ownNominationCountByContest.get(nomination.contest_id) ?? 0) + 1,
      );
    }
  }

  for (const candidate of candidates ?? []) {
    candidateCountByContest.set(
      candidate.contest_id,
      (candidateCountByContest.get(candidate.contest_id) ?? 0) + 1,
    );
  }

  if (profile && !isAdmin) {
    nominatableContests = nominatableContests.filter((contest) => {
      if (contest.max_nominations_per_user === null) {
        return true;
      }

      return (
        (ownNominationCountByContest.get(contest.id) ?? 0) <
        contest.max_nominations_per_user
      );
    });
  }

  const coverUrl = getPublicImageUrl(group.cover_image_path);

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
        <div className="flex flex-col justify-between gap-5 p-8 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-3xl font-semibold tracking-normal">
              参与组内提名：{group.name}
            </h1>
            <p className="mt-4 max-w-3xl leading-7 text-muted-foreground">
              {group.description || "暂无简介。"}
            </p>
            {!profile ? (
              <p className="mt-3 inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-[#EED8AA] bg-white/70 px-3 py-1 text-sm text-muted-foreground">
                <LogIn className="size-4" />
                提交提名需要登录。
              </p>
            ) : null}
          </div>
          <Button asChild variant="outline">
            <Link href={`/groups/${group.id}`}>返回活动组</Link>
          </Button>
        </div>
      </div>

      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-xl font-semibold">可提名活动</h2>
        <span className="text-sm text-muted-foreground">
          {nominatableContests.length}
        </span>
      </div>

      {nominatableContests.length > 0 ? (
        <div className="grid gap-5 md:grid-cols-2">
          {nominatableContests.map((contest) => {
            const ownCount = ownNominationCountByContest.get(contest.id) ?? 0;
            const remaining =
              !profile || isAdmin || contest.max_nominations_per_user === null
                ? null
                : Math.max(0, contest.max_nominations_per_user - ownCount);

            return (
              <Card
                key={contest.id}
                className="flex h-full flex-col border-[#EED8AA]/70 bg-[#FFFCF4]/90"
              >
                <CardHeader>
                  <div className="mb-3">
                    <StatusBadge status={contest.status} />
                  </div>
                  <CardTitle>{contest.title}</CardTitle>
                </CardHeader>
                <CardContent className="flex-1 space-y-3">
                  <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">
                    {contest.description || "暂无简介。"}
                  </p>
                  <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                    <div>已有提名：{nominationCountByContest.get(contest.id) ?? 0}</div>
                    <div>已有候选项：{candidateCountByContest.get(contest.id) ?? 0}</div>
                    <div className="sm:col-span-2">
                      {isAdmin
                        ? "管理员可提名。"
                        : !profile
                          ? "登录后按活动规则提名。"
                          : remaining === null
                            ? "当前活动不限制提名数量。"
                            : `你还可以提名 ${remaining} 个。`}
                    </div>
                  </div>
                </CardContent>
                <CardFooter>
                  <Button asChild className="w-full">
                    <Link href={`/contests/${contest.id}/nominate`}>
                      <Send className="size-4" />
                      去提名
                    </Link>
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      ) : (
        <MascotEmptyState kind="emptyCandidates" title="当前活动组暂无可提名活动">
          可能尚未进入提名阶段，或你的提名数量已达上限。
        </MascotEmptyState>
      )}
    </div>
  );
}
