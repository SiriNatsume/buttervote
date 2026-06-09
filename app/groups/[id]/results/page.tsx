import Link from "next/link";
import { notFound } from "next/navigation";
import { ImageIcon, Trophy } from "lucide-react";
import { StatusBadge, VoteTypeBadge } from "@/components/contest-badges";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { canViewResults } from "@/lib/contest-rules";
import { getCurrentProfile } from "@/lib/auth";
import { getPublicImageUrl } from "@/lib/image/image-url";
import { applyScheduledTransitions } from "@/lib/scheduled-transitions";
import { createClient } from "@/lib/supabase/server";
import { createServerDataClient } from "@/lib/supabase/server-data";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { tallyVotes, type TallyResult } from "@/lib/tally";
import type { Candidate, Contest, LoveVoteAllocation, Vote } from "@/lib/types";

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
>;

type ContestSummary = {
  contest: ResultContest;
  topResults: TallyResult[];
};

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
        "id,title,description,status,vote_type,group_id,closed_result_visibility,live_results_enabled,created_at",
      )
      .eq("group_id", id)
      .is("archived_at", null)
      .neq("status", "draft")
      .order("created_at", { ascending: true }),
  ]);

  if (!group) {
    notFound();
  }

  const isAdmin = profile?.role === "admin";
  const visibleContests = (contests ?? []).filter((contest) =>
    canViewResults(contest, profile),
  );
  const visibleContestIds = visibleContests.map((contest) => contest.id);
  const candidateClient = isAdmin ? dataClient : supabase;
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

  const summaries: ContestSummary[] = visibleContests.map((contest) => {
    const results = tallyVotes({
      voteType: contest.vote_type,
      candidates: candidatesByContest.get(contest.id) ?? [],
      votes: votesByContest.get(contest.id) ?? [],
      loveVoteWeight: contest.group_id ? Number(group.love_vote_weight) : null,
      loveAllocations: loveAllocationsByContest.get(contest.id) ?? [],
    });

    return {
      contest,
      topResults: results.slice(0, 3),
    };
  });
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

      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-xl font-semibold">可查看结果</h2>
        <span className="text-sm text-muted-foreground">{summaries.length}</span>
      </div>

      {summaries.length > 0 ? (
        <div className="grid gap-5 md:grid-cols-2">
          {summaries.map(({ contest, topResults }) => (
            <Card
              key={contest.id}
              className="flex h-full flex-col border-[#EED8AA]/70 bg-[#FFFCF4]/90"
            >
              <CardHeader>
                <div className="mb-3 flex flex-wrap gap-2">
                  <StatusBadge status={contest.status} />
                  <VoteTypeBadge voteType={contest.vote_type} />
                </div>
                <CardTitle>{contest.title}</CardTitle>
              </CardHeader>
              <CardContent className="flex-1 space-y-3">
                <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">
                  {contest.description || "暂无简介。"}
                </p>
                {topResults.length > 0 ? (
                  <div className="space-y-2">
                    {topResults.map((result) => (
                      <div
                        key={result.candidateId}
                        className="flex items-center justify-between rounded-2xl border border-[#EED8AA]/70 bg-white/70 px-3 py-2 text-sm"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <Trophy className="size-4 text-[#B9854C]" />
                          <span className="shrink-0">
                            排序第 {result.position} 位
                          </span>
                          <span className="truncate font-medium">
                            {result.name}
                          </span>
                        </div>
                        <span className="shrink-0 font-semibold">
                          {result.score} 分
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl border p-4 text-sm text-muted-foreground">
                    暂无候选项或票数。
                  </div>
                )}
              </CardContent>
              <CardFooter>
                <Button asChild className="w-full" variant="outline">
                  <Link href={`/contests/${contest.id}/results`}>
                    查看完整结果
                  </Link>
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border p-8 text-muted-foreground">
          当前活动组暂无可查看结果。结果公开后会在这里显示。
        </div>
      )}
    </div>
  );
}
