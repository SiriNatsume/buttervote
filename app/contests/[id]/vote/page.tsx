import Link from "next/link";
import { redirect } from "next/navigation";
import { Countdown } from "@/components/countdown";
import { GroupAccessDeniedPanel } from "@/components/group-access-denied-panel";
import { VoteForm } from "@/components/vote-form";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { canParticipateContestGroup } from "@/lib/permissions/user-groups";
import { applyDueScheduledTransitionsForContest } from "@/lib/scheduled-transitions";
import { createServerDataClient } from "@/lib/supabase/server-data";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { tallyVotes } from "@/lib/tally";
import { formatDateTime } from "@/lib/time";
import type { LoveVoteAllocation, Vote } from "@/lib/types";

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
  const supabase = await createServerDataClient();
  const [{ data: contest }, { data: existingVote }, { data: candidates }] =
    await Promise.all([
      supabase
        .from("contests")
        .select(
          "id,title,status,vote_type,max_choices,require_exact_choices,group_id,love_vote_enabled,live_results_enabled,show_candidate_image,show_candidate_description,show_nominator_info,voting_ends_at,archived_at",
        )
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("votes")
        .select("id")
        .eq("contest_id", id)
        .eq("voter_id", user.id)
        .maybeSingle(),
      supabase
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
      ? await supabase
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
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <div className="butter-panel p-8">
          <h1 className="text-2xl font-semibold tracking-normal">已投票</h1>
          <p className="mt-3 leading-7 text-muted-foreground">
            你已经参与过该活动投票，不能重复投票。
          </p>
          {query.error ? (
            <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {query.error}
            </div>
          ) : null}
          <Button asChild className="mt-6">
            <Link href={`/contests/${contest.id}`}>返回活动详情</Link>
          </Button>
        </div>
      </div>
    );
  }

  let realtimeScores: Record<string, number> | undefined;

  if (contest.live_results_enabled) {
    const [
      { data: voteRows, error: voteRowsError },
      { data: loveRows, error: loveRowsError },
    ] = await Promise.all([
      fetchAllRows<Vote>(() =>
        supabase
          .from("votes")
          .select("id,contest_id,voter_id,payload,created_at")
          .eq("contest_id", id)
          .order("created_at", { ascending: true }),
      ),
      contest.group_id
        ? fetchAllRows<Pick<LoveVoteAllocation, "vote_id" | "candidate_id">>(
            () =>
              supabase
                .from("love_vote_allocations")
                .select("vote_id,candidate_id")
                .eq("contest_id", id),
          )
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (voteRowsError || loveRowsError) {
      console.error(
        "Failed to load live vote page scores.",
        voteRowsError?.message ?? loveRowsError?.message,
      );
    } else {
      const results = tallyVotes({
        voteType: contest.vote_type,
        candidates: candidates ?? [],
        votes: voteRows ?? [],
        loveVoteWeight: group ? Number(group.love_vote_weight) : null,
        loveVoteScoreMode: "base",
        loveAllocations: loveRows ?? [],
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
