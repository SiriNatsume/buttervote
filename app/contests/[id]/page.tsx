import Link from "next/link";
import { notFound } from "next/navigation";
import { BarChart3, CalendarClock, ImageIcon, Send, Trophy } from "lucide-react";
import { CandidateCard } from "@/components/candidate-card";
import { Countdown } from "@/components/countdown";
import { ExistingNominationsList } from "@/components/existing-nominations-list";
import { StatusBadge, VoteTypeBadge } from "@/components/contest-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { canViewResults } from "@/lib/contest-rules";
import { getCurrentProfile } from "@/lib/auth";
import { getPublicImageUrl } from "@/lib/image/image-url";
import { canParticipateContestGroup } from "@/lib/permissions/user-groups";
import { applyDueScheduledTransitionsForContest } from "@/lib/scheduled-transitions";
import { createClient } from "@/lib/supabase/server";
import { createServerDataClient } from "@/lib/supabase/server-data";
import { formatDateTime } from "@/lib/time";

export default async function ContestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await applyDueScheduledTransitionsForContest(id, { revalidate: false });
  const supabase = await createClient();
  const [{ data: contest }, { data: candidates }, profile] = await Promise.all([
    supabase
      .from("contests")
      .select(
        "id,title,description,status,vote_type,max_choices,group_id,show_candidate_image,show_candidate_description,show_nominator_info,show_existing_nominations,max_nominations_per_user,candidate_description_max_length,live_results_enabled,closed_result_visibility,love_vote_enabled,voting_starts_at,voting_ends_at,image_path",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("candidates")
      .select("id,name,description,image_path,nominator_display_name,created_at")
      .eq("contest_id", id)
      .eq("is_active", true)
      .order("created_at", { ascending: true }),
    getCurrentProfile(),
  ]);

  if (!contest) {
    notFound();
  }

  const { data: group } = contest.group_id
    ? await supabase
        .from("contest_groups")
        .select("id,name,access_mode")
        .eq("id", contest.group_id)
        .maybeSingle()
    : { data: null };
  const imageUrl = getPublicImageUrl(contest.image_path);
  const isAdmin = profile?.role === "admin";
  const resultsVisible = canViewResults(contest, profile);
  const dataClient = await createServerDataClient();
  const { data: existingVote } = profile
    ? await dataClient
        .from("votes")
        .select("id")
        .eq("contest_id", contest.id)
        .eq("voter_id", profile.id)
        .maybeSingle()
    : { data: null };
  const hasVoted = Boolean(existingVote);
  const isRestrictedGroup = group?.access_mode === "restricted";
  const canParticipateGroup = isRestrictedGroup
    ? await canParticipateContestGroup({
        contestGroupId: group.id,
        profile,
      })
    : true;
  const canUseGroupParticipation = !isRestrictedGroup || canParticipateGroup;
  const noVotingPermission =
    contest.status === "voting" && isRestrictedGroup && !canParticipateGroup;
  const canShowExistingNominations =
    ["nominating", "admin_nominating", "waiting"].includes(contest.status) &&
    (isAdmin || contest.show_existing_nominations === true);
  const { data: existingNominations } = canShowExistingNominations
    ? await dataClient
        .from("nominations")
        .select("id,name,description,status,nominator_display_name,created_at")
        .eq("contest_id", contest.id)
        .neq("status", "draft")
        .order("created_at", { ascending: true })
    : { data: [] };
  const validVotingDeadline =
    contest.status === "voting" &&
    contest.voting_ends_at &&
    new Date(contest.voting_ends_at).getTime() > Date.now()
      ? contest.voting_ends_at
      : null;
  const hasValidVotingDeadline = Boolean(validVotingDeadline);
  let nominationLimitText: string | null = null;
  let nominationLimitReached = false;

  if (contest.status === "nominating") {
    if (isRestrictedGroup && !canParticipateGroup) {
      nominationLimitText = profile
        ? "你暂时没有参与该活动组提名的权限。"
        : "该活动组仅限指定用户组成员提名，请通过 QQ bot 专属链接登录。";
      nominationLimitReached = true;
    } else if (!profile) {
      nominationLimitText = "登录后可以提交提名。";
    } else if (isAdmin || contest.max_nominations_per_user === null) {
      nominationLimitText = "该活动不限制提名数量。";
    } else {
      const { count } = await dataClient
        .from("nominations")
        .select("id", { count: "exact", head: true })
        .eq("contest_id", contest.id)
        .eq("submitter_id", profile.id)
        .neq("status", "rejected");
      const remaining = Math.max(
        0,
        contest.max_nominations_per_user - (count ?? 0),
      );
      nominationLimitReached = remaining <= 0;
      nominationLimitText = nominationLimitReached
        ? "你在该活动中的提名数量已达上限。"
        : `你还可以提名 ${remaining} 个。`;
    }
  }

  const cta =
    contest.status === "nominating" &&
    !nominationLimitReached &&
    canUseGroupParticipation
      ? {
          href: `/contests/${contest.id}/nominate`,
          label: "提交提名",
          icon: Send,
        }
        : contest.status === "admin_nominating" &&
            isAdmin &&
            canUseGroupParticipation
          ? {
              href: `/contests/${contest.id}/nominate`,
              label: "管理员提名",
              icon: Send,
            }
        : contest.status === "voting" && !hasVoted && canUseGroupParticipation
          ? {
              href: `/contests/${contest.id}/vote`,
              label: "去投票",
              icon: BarChart3,
            }
          : contest.status === "voting"
            ? null
          : resultsVisible
            ? {
                href: `/contests/${contest.id}/results`,
                label: "查看结果",
                icon: Trophy,
              }
            : null;

  const CtaIcon = cta?.icon;

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <div className="mb-8 overflow-hidden rounded-3xl border border-[#EED8AA]/70 bg-[#FFFCF4]/90 shadow-sm">
        <div className="aspect-video bg-muted">
          {imageUrl ? (
              <img
                src={imageUrl}
              alt={`${contest.title} 封面`}
                className="size-full object-cover"
              />
          ) : (
            <div className="butter-placeholder flex size-full items-center justify-center">
              <ImageIcon className="size-10" aria-hidden="true" />
            </div>
          )}
        </div>
        <div className="p-8">
          <div className="mb-4 flex flex-wrap gap-2">
            <StatusBadge status={contest.status} />
            <VoteTypeBadge voteType={contest.vote_type} />
            {group ? (
              <Badge variant="secondary">
                <Link href={`/groups/${group.id}`}>{group.name}</Link>
              </Badge>
            ) : null}
          </div>
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div>
              <h1 className="text-3xl font-semibold tracking-normal">
                {contest.title}
              </h1>
              <p className="mt-4 max-w-3xl leading-7 text-muted-foreground">
                {contest.description || "暂无简介。"}
              </p>
              <div className="mt-4 space-y-2 text-sm text-muted-foreground">
                {nominationLimitText ? <p>{nominationLimitText}</p> : null}
                {contest.status === "waiting" ? (
                  contest.voting_starts_at ? (
                    <p className="flex flex-wrap items-center gap-2">
                      <CalendarClock className="size-4" />
                      投票将于 {formatDateTime(contest.voting_starts_at)} 开始，
                      <Countdown
                        targetTime={contest.voting_starts_at}
                        prefix="距离投票开始还有 "
                        expiredText="投票开始时间已到，正在更新状态..."
                        refreshOnExpire
                      />
                    </p>
                  ) : (
                    <p>投票即将开始。</p>
                  )
                ) : null}
                {validVotingDeadline ? (
                  <p className="flex flex-wrap items-center gap-2">
                    <CalendarClock className="size-4" />
                    投票截止时间：{formatDateTime(validVotingDeadline)}，
                    <Countdown
                      targetTime={validVotingDeadline}
                      prefix="距离投票结束还有 "
                      expiredText="投票结束时间已到，正在更新状态..."
                      refreshOnExpire
                    />
                  </p>
                ) : null}
                {contest.status === "voting" && contest.live_results_enabled ? (
                  <p>
                    实时票数已公开，可以
                    <Link
                      href={`/contests/${contest.id}/results`}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      查看实时结果
                    </Link>
                    。
                  </p>
                ) : null}
                {contest.status === "voting" && hasVoted ? (
                  <p>你已经参与过该活动投票。</p>
                ) : null}
                {noVotingPermission ? (
                  <p>你暂时没有参与该活动组投票的权限。</p>
                ) : null}
                {contest.status === "voting" && !hasValidVotingDeadline ? (
                  <p className="flex flex-wrap items-center gap-2">
                    <CalendarClock className="size-4" />
                    当前未设置投票截止时间
                  </p>
                ) : null}
                {contest.status === "closed" && !resultsVisible ? (
                  <p>当前活动结果暂未公开。</p>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              {contest.status === "voting" && hasVoted ? (
                <Button size="lg" disabled>
                  已投票
                </Button>
              ) : null}
              {cta && CtaIcon ? (
                <Button asChild size="lg">
                  <Link href={cta.href}>
                    <CtaIcon className="size-4" />
                    {cta.label}
                  </Link>
                </Button>
              ) : null}
              {contest.status === "voting" &&
              resultsVisible &&
              (hasVoted || isAdmin) ? (
                <Button asChild size="lg" variant="outline">
                  <Link href={`/contests/${contest.id}/results`}>
                    <Trophy className="size-4" />
                    {isAdmin && !hasVoted ? "预览票数" : "查看结果"}
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {canShowExistingNominations ? (
        <div className="mb-8">
          <ExistingNominationsList
            nominations={existingNominations ?? []}
            showNominatorInfo={contest.show_nominator_info !== false}
            defaultOpen={false}
          />
        </div>
      ) : null}

      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-xl font-semibold">候选项</h2>
        <span className="text-sm text-muted-foreground">
          {(candidates ?? []).length}
        </span>
      </div>

      {candidates && candidates.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          {candidates.map((candidate) => (
            <CandidateCard
              key={candidate.id}
              candidate={candidate}
              showImage={contest.show_candidate_image}
              showDescription={contest.show_candidate_description}
              showNominatorInfo={contest.show_nominator_info}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border p-8 text-muted-foreground">
          当前活动暂无候选项。请在提名或后台添加候选项后再投票。
        </div>
      )}
    </div>
  );
}
