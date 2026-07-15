import Link from "next/link";
import { redirect } from "next/navigation";
import { Countdown } from "@/components/countdown";
import { GroupAccessDeniedPanel } from "@/components/group-access-denied-panel";
import { LoveVoteSupplementPanel } from "@/components/love-vote-supplement-panel";
import { MascotEmptyState } from "@/components/mascot";
import { VoteForm } from "@/components/vote-form";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { canParticipateContestGroup } from "@/lib/permissions/user-groups";
import { loadContestResultVisibilityByContest } from "@/lib/result-visibility";
import { applyDueScheduledTransitionsForContest } from "@/lib/scheduled-transitions";
import { createClient } from "@/lib/supabase/server";
import { createServerDataClient } from "@/lib/supabase/server-data";
import { tallyVotes } from "@/lib/tally";
import { selectedCandidateIdsFromVotePayload } from "@/lib/vote-payload";
import { formatDateTime } from "@/lib/time";
import { loadVisibleContestResultData } from "@/lib/visible-result-data";

export default async function VotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  await applyDueScheduledTransitionsForContest(id, { revalidate: false });
  const [supabase, dataClient] = await Promise.all([
    createClient(),
    createServerDataClient(),
  ]);
  const [{ data: contest }, { data: existingVote }, { data: candidates }] =
    await Promise.all([
      supabase
        .from("contests")
        .select(
          "id,title,status,vote_type,max_choices,require_exact_choices,group_id,love_vote_enabled,show_candidate_image,show_candidate_description,show_nominator_info,voting_ends_at,archived_at",
        )
        .eq("id", id)
        .maybeSingle(),
      dataClient
        .from("votes")
        .select("id,payload")
        .eq("contest_id", id)
        .eq("voter_id", user.id)
        .maybeSingle(),
      (user.role === "admin" ? dataClient : supabase)
        .from("candidates")
        .select("id,name,description,image_path,nominator_display_name,is_active,created_at")
        .eq("contest_id", id)
        .eq("is_active", true)
        .order("created_at", { ascending: true }),
    ]);

  if (!contest || contest.archived_at || contest.status !== "voting") {
    redirect(`/contests/${id}`);
  }

  const { data: group } = contest.group_id
    ? await supabase
        .from("contest_groups")
        .select("id,name,love_vote_quota,love_vote_weight,access_mode")
        .eq("id", contest.group_id)
        .maybeSingle()
    : { data: null };

  if (contest.group_id && group) {
    const canParticipate = await canParticipateContestGroup({
      contestGroupId: group.id,
      profile: user,
    });

    if (!canParticipate) {
      return (
        <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
          <GroupAccessDeniedPanel backHref={`/contests/${contest.id}`} />
        </div>
      );
    }
  }

  const { count: usedLoveVotes } =
    contest.group_id && contest.love_vote_enabled !== false
      ? await dataClient
          .from("love_vote_allocations")
          .select("id", { count: "exact", head: true })
          .eq("group_id", contest.group_id)
          .eq("voter_id", user.id)
      : { count: 0 };
  const loveVoteInfo =
    group &&
    contest.love_vote_enabled !== false &&
    Number(group.love_vote_weight) > 1 &&
    Number(group.love_vote_quota) > 0
      ? {
          groupId: group.id,
          groupName: group.name,
          quota: Number(group.love_vote_quota),
          weight: Number(group.love_vote_weight),
          used: usedLoveVotes ?? 0,
        }
      : null;

  if (existingVote) {
    const selectedCandidateIds = selectedCandidateIdsFromVotePayload(
      contest.vote_type,
      existingVote.payload,
    );
    const selectedCandidateIdSet = new Set(selectedCandidateIds);
    const { data: existingLoveRows } =
      loveVoteInfo && selectedCandidateIds.length > 0
        ? await dataClient
            .from("love_vote_allocations")
            .select("candidate_id")
            .eq("vote_id", existingVote.id)
        : { data: [] };
    const supplementCandidates = (candidates ?? []).filter((candidate) =>
      selectedCandidateIdSet.has(candidate.id),
    );

    return (
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <MascotEmptyState
          kind="voteSuccess"
          title="已投票"
          actions={
            <Button asChild>
              <Link href={`/contests/${contest.id}`}>返回活动详情</Link>
            </Button>
          }
        >
          <p>你已经参与过该活动投票，不能重复提交普通投票。</p>
          {query.error ? (
            <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {query.error}
            </div>
          ) : null}
        </MascotEmptyState>

        {loveVoteInfo ? (
          <LoveVoteSupplementPanel
            className="mt-6"
            groupId={loveVoteInfo.groupId}
            quota={loveVoteInfo.quota}
            weight={loveVoteInfo.weight}
            used={loveVoteInfo.used}
            contests={[
              {
                id: contest.id,
                title: contest.title,
                show_candidate_image: contest.show_candidate_image,
                show_candidate_description: contest.show_candidate_description,
                show_nominator_info: contest.show_nominator_info,
                candidates: supplementCandidates,
                alreadyLoveCandidateIds: (existingLoveRows ?? []).map(
                  (row) => row.candidate_id,
                ),
              },
            ]}
          />
        ) : null}
      </div>
    );
  }

  let realtimeScores: Record<string, number> | undefined;
  const resultVisibilityByContest =
    await loadContestResultVisibilityByContest(
      user.role === "admin" ? dataClient : supabase,
      [contest],
      { includeAdminOverride: user.role === "admin" },
    );

  if (resultVisibilityByContest.get(contest.id)?.fullResultsVisible) {
    const resultData = await loadVisibleContestResultData(
      user.role === "admin" ? dataClient : supabase,
      [id],
      { includeAdminOverride: user.role === "admin" },
    );

    if (resultData.error) {
      console.error(
        "Failed to load live vote page scores.",
        resultData.error.message,
      );
    } else {
      const results = tallyVotes({
        voteType: contest.vote_type,
        candidates: candidates ?? [],
        votes: resultData.votes.map((vote) => ({ ...vote, voter_id: null })),
        loveVoteWeight: group ? Number(group.love_vote_weight) : null,
        loveVoteScoreMode: "base",
        loveAllocations: resultData.loveAllocations,
      });

      realtimeScores = Object.fromEntries(
        results.map((result) => [result.candidateId, result.score]),
      );
    }
  }
  const validVotingDeadline =
    contest.voting_ends_at &&
    new Date(contest.voting_ends_at).getTime() > Date.now()
      ? contest.voting_ends_at
      : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-normal">
          投票：{contest.title}
        </h1>
        <p className="mt-3 text-muted-foreground">
          投票提交后不可修改。
        </p>
        {validVotingDeadline ? (
          <p className="mt-2 text-sm text-muted-foreground">
            投票截止时间：{formatDateTime(validVotingDeadline)}，
            <Countdown
              targetTime={validVotingDeadline}
              prefix="距离投票结束还有 "
              expiredText="投票结束时间已到，正在更新状态..."
              refreshOnExpire
            />
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            当前未设置投票截止时间
          </p>
        )}
      </div>

      <VoteForm
        contest={contest}
        candidates={candidates ?? []}
        error={query.error}
        loveVoteInfo={loveVoteInfo}
        realtimeScores={realtimeScores}
      />
    </div>
  );
}
