import Link from "next/link";
import { notFound } from "next/navigation";
import { ImageIcon } from "lucide-react";
import {
  ContestCallingAutoRefresh,
  type ContestCallingRefreshWatch,
} from "@/components/contest-calling-auto-refresh";
import { Button } from "@/components/ui/button";
import {
  GroupResultSummaryList,
  type GroupContestResultSummary,
} from "@/components/group-result-summary-list";
import { canViewResults } from "@/lib/contest-rules";
import { getCurrentProfile } from "@/lib/auth";
import { getPublicImageUrl } from "@/lib/image/image-url";
import { applyScheduledTransitions } from "@/lib/scheduled-transitions";
import { createClient } from "@/lib/supabase/server";
import { createServerDataClient } from "@/lib/supabase/server-data";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { tallyVotes } from "@/lib/tally";
import type { Candidate, Contest, ContestCallingSession, LoveVoteAllocation, Vote } from "@/lib/types";

type ResultCandidate = Pick<
  Candidate,
  "id" | "contest_id" | "name" | "description" | "image_path" | "nominator_display_name" | "is_active"
>;

type ResultContest = Pick<
  Contest,
  | "id"
  | "title"
  | "description"
  | "status"
  | "vote_type"
  | "group_id"
  | "closed_result_visibility"
  | "live_results_enabled"
  | "created_at"
  | "updated_at"
>;

type GroupLoveVoteRow = Pick<
  LoveVoteAllocation,
  "contest_id" | "vote_id" | "candidate_id"
>;

export default async function GroupResultsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await applyScheduledTransitions({ revalidate: false });
  const supabase = await createClient();
  const [profile, dataClient] = await Promise.all([
    getCurrentProfile(),
    createServerDataClient(),
  ]);
  const [{ data: group }, { data: contests }] = await Promise.all([
    supabase
      .from("contest_groups")
      .select("id,name,description,cover_image_path,love_vote_weight")
      .eq("id", id)
      .maybeSingle(),
    dataClient
      .from("contests")
      .select(
        "id,title,description,status,vote_type,group_id,closed_result_visibility,live_results_enabled,created_at,updated_at",
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

  const isAdmin = profile?.role === "admin";
  const contestIds = (contests ?? []).map((contest) => contest.id);
  let callingSessionQuery = dataClient
    .from("contest_calling_sessions")
    .select(
      "id,contest_id,status,current_step,total_steps,play_mode,auto_interval_seconds,seed,metadata,created_by,started_at,completed_at,archived_at,created_at,updated_at",
    )
    .is("archived_at", null);

  if (contestIds.length > 0) {
    callingSessionQuery = callingSessionQuery.in("contest_id", contestIds);
  }

  if (!isAdmin) {
    callingSessionQuery = callingSessionQuery.in("status", [
      "active",
      "paused",
      "completed",
    ]);
  }

  const { data: callingSessionRows } =
    contestIds.length > 0
      ? await callingSessionQuery.order("created_at", { ascending: false })
      : { data: [] };
  const callingSessionByContest = new Map<string, ContestCallingSession>();

  for (const session of (callingSessionRows ?? []) as ContestCallingSession[]) {
    if (!callingSessionByContest.has(session.contest_id)) {
      callingSessionByContest.set(session.contest_id, session);
    }
  }

  const visibleContests = (contests ?? []).filter((contest) => {
    if (canViewResults(contest, profile)) {
      return true;
    }
    const callingSession = callingSessionByContest.get(contest.id);
    return (
      callingSession?.status === "active" ||
      callingSession?.status === "paused" ||
      callingSession?.status === "completed"
    );
  });
  const visibleContestIds = visibleContests.map((contest) => contest.id);
  const callingAutoRefreshWatches: ContestCallingRefreshWatch[] = !isAdmin
    ? visibleContests.flatMap((contest) => {
        const session = callingSessionByContest.get(contest.id);
        if (!session || (session.status !== "active" && session.status !== "paused")) {
          return [];
        }
        return [
          {
            contestId: contest.id,
            sessionId: session.id,
            status: session.status,
            currentStep: Math.max(0, Number(session.current_step) || 0),
            totalSteps: Math.max(0, Number(session.total_steps) || 0),
            updatedAt: session.updated_at ?? null,
          },
        ];
      })
    : [];
  const candidateClient = dataClient;
  const { data: candidateRows } =
    visibleContestIds.length > 0
      ? await candidateClient
          .from("candidates")
          .select("id,contest_id,name,description,image_path,nominator_display_name,is_active,created_at")
          .in("contest_id", visibleContestIds)
          .order("created_at", { ascending: true })
      : { data: [] };
  const candidates = isAdmin
    ? candidateRows ?? []
    : (candidateRows ?? []).filter((candidate) => candidate.is_active !== false);
  const candidatesByContest = new Map<string, ResultCandidate[]>();

  for (const candidate of candidates) {
    const current = candidatesByContest.get(candidate.contest_id) ?? [];
    current.push(candidate);
    candidatesByContest.set(candidate.contest_id, current);
  }

  const votesByContest = new Map<string, Vote[]>();
  const loveAllocationsByContest = new Map<
    string,
    Array<Pick<LoveVoteAllocation, "vote_id" | "candidate_id">>
  >();

  if (visibleContestIds.length > 0) {
    const [
      { data: voteRows, error: voteRowsError },
      { data: loveRows, error: loveRowsError },
    ] = await Promise.all([
      fetchAllRows<Vote>(() =>
        dataClient
          .from("votes")
          .select("id,contest_id,voter_id,payload,created_at")
          .in("contest_id", visibleContestIds)
          .order("created_at", { ascending: true }),
      ),
      fetchAllRows<GroupLoveVoteRow>(() =>
        dataClient
          .from("love_vote_allocations")
          .select("contest_id,vote_id,candidate_id")
          .in("contest_id", visibleContestIds),
      ),
    ]);

    if (voteRowsError || loveRowsError) {
      console.error(
        "Failed to load group result votes.",
        voteRowsError?.message ?? loveRowsError?.message,
      );
    } else {
      for (const vote of voteRows ?? []) {
        const current = votesByContest.get(vote.contest_id) ?? [];
        current.push(isAdmin ? vote : { ...vote, voter_id: null });
        votesByContest.set(vote.contest_id, current);
      }

      for (const loveRow of loveRows ?? []) {
        const current = loveAllocationsByContest.get(loveRow.contest_id) ?? [];
        current.push({
          vote_id: loveRow.vote_id,
          candidate_id: loveRow.candidate_id,
        });
        loveAllocationsByContest.set(loveRow.contest_id, current);
      }
    }
  }

  const summaries: GroupContestResultSummary[] = visibleContests
    .map((contest) => {
      const callingSession = callingSessionByContest.get(contest.id) ?? null;
      const callingInProgress =
        !isAdmin &&
        (callingSession?.status === "active" || callingSession?.status === "paused");
      const callingCompleted = callingSession?.status === "completed";
      const shouldHideLoveWeight = !isAdmin && contest.status !== "published" && !callingCompleted;
      const results = tallyVotes({
        voteType: contest.vote_type,
        candidates: candidatesByContest.get(contest.id) ?? [],
        votes: votesByContest.get(contest.id) ?? [],
        loveVoteWeight: contest.group_id ? Number(group.love_vote_weight) : null,
        loveVoteScoreMode: shouldHideLoveWeight ? "base" : "weighted",
        loveAllocations: loveAllocationsByContest.get(contest.id) ?? [],
      });
      const resultPublishedAt = contest.updated_at ?? contest.created_at ?? null;

      return {
        contest: {
          id: contest.id,
          title: contest.title,
          description: contest.description,
          status: contest.status,
          vote_type: contest.vote_type,
          resultPublishedAt,
        },
        topResults: callingInProgress ? [] : results.slice(0, 4),
        calling: callingSession
          ? {
              status: callingSession.status,
              currentStep: callingSession.current_step,
              totalSteps: callingSession.total_steps,
            }
          : null,
      };
    })
    .sort((a, b) => {
      const left = a.contest.resultPublishedAt
        ? Date.parse(a.contest.resultPublishedAt)
        : 0;
      const right = b.contest.resultPublishedAt
        ? Date.parse(b.contest.resultPublishedAt)
        : 0;

      return right - left;
    });
  const coverUrl = getPublicImageUrl(group.cover_image_path);

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <ContestCallingAutoRefresh watches={callingAutoRefreshWatches} />
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
              查询组内结果：{group.name}
            </h1>
            <p className="mt-4 max-w-3xl leading-7 text-muted-foreground">
              {group.description || "暂无简介。"}
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href={`/groups/${group.id}`}>返回活动组</Link>
          </Button>
        </div>
      </div>

      <GroupResultSummaryList summaries={summaries} />

    </div>
  );
}
