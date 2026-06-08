import Link from "next/link";
import { notFound } from "next/navigation";
import { ResultList } from "@/components/result-list";
import { Heart } from "lucide-react";
import { StatusBadge, VoteTypeBadge } from "@/components/contest-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { canViewResults } from "@/lib/contest-rules";
import { getCurrentProfile } from "@/lib/auth";
import { applyDueScheduledTransitionsForContest } from "@/lib/scheduled-transitions";
import { createClient } from "@/lib/supabase/server";
import { createServerDataClient } from "@/lib/supabase/server-data";
import { tallyVotes } from "@/lib/tally";
import type { LoveVoteAllocation, Vote } from "@/lib/types";

export default async function ResultsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await applyDueScheduledTransitionsForContest(id, { revalidate: false });
  const supabase = await createClient();
  const [{ data: contest }, profile] = await Promise.all([
    supabase
      .from("contests")
      .select(
        "id,title,description,status,vote_type,group_id,show_candidate_image,show_candidate_description,show_nominator_info,live_results_enabled,closed_result_visibility",
      )
      .eq("id", id)
      .maybeSingle(),
    getCurrentProfile(),
  ]);

  if (!contest) {
    notFound();
  }

  const isAdmin = profile?.role === "admin";
  const canReadAllVotes = canViewResults(contest, profile);
  const dataClient = isAdmin ? await createServerDataClient() : supabase;
  const { data: candidates } = await dataClient
    .from("candidates")
    .select("id,name,description,image_path,nominator_display_name,is_active,created_at")
    .eq("contest_id", id)
    .order("created_at", { ascending: true });
  const visibleCandidates = isAdmin
    ? candidates ?? []
    : (candidates ?? []).filter((candidate) => candidate.is_active !== false);

  const { data: group } = contest.group_id
    ? await supabase
        .from("contest_groups")
        .select("id,name,love_vote_weight")
        .eq("id", contest.group_id)
        .maybeSingle()
    : { data: null };

  let votes: Vote[] = [];
  let loveAllocations: Array<Pick<LoveVoteAllocation, "vote_id" | "candidate_id">> =
    [];

  if (isAdmin) {
    const [{ data: voteRows }, { data: loveRows }] = await Promise.all([
      dataClient
        .from("votes")
        .select("id,contest_id,voter_id,payload,created_at")
        .eq("contest_id", id)
        .order("created_at", { ascending: true }),
      contest.group_id
        ? dataClient
            .from("love_vote_allocations")
            .select("vote_id,candidate_id")
            .eq("contest_id", id)
        : Promise.resolve({ data: [] }),
    ]);
    votes = voteRows ?? [];
    loveAllocations = loveRows ?? [];
  } else if (canReadAllVotes) {
    const [{ data: voteRows }, { data: loveRows }] = await Promise.all([
      supabase.rpc("get_contest_vote_payloads", {
        p_contest_id: id,
      }),
      contest.group_id
        ? supabase.rpc("get_contest_love_vote_allocations", {
            p_contest_id: id,
          })
        : Promise.resolve({ data: [] }),
    ]);
    votes = (voteRows ?? []).map((vote) => ({
      ...vote,
      voter_id: null,
    }));
    loveAllocations = loveRows ?? [];
  }

  const results = tallyVotes({
    voteType: contest.vote_type,
    candidates: visibleCandidates,
    votes,
    loveVoteWeight: group ? Number(group.love_vote_weight) : null,
    loveAllocations,
  });
  const showLoveBreakdown = canReadAllVotes && contest.status !== "voting";
  const totalLoveVotes = loveAllocations.length;

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <div className="butter-panel mb-8 p-8">
        <div className="mb-4 flex flex-wrap gap-2">
          <StatusBadge status={contest.status} />
          <VoteTypeBadge voteType={contest.vote_type} />
          {group ? (
            <Badge variant="love">
              <Heart className="mr-1 size-3 fill-current" />
              真爱票权重 x{Number(group.love_vote_weight)}
            </Badge>
          ) : null}
        </div>
        <h1 className="text-3xl font-semibold tracking-normal">
          结果：{contest.title}
        </h1>
        <p className="mt-4 max-w-3xl leading-7 text-muted-foreground">
          {contest.description || "暂无简介。"}
        </p>
      </div>

      {!canReadAllVotes ? (
        <div className="butter-panel p-8 text-muted-foreground">
          当前活动结果暂未公开。公开后你可以在这里查看完整结果。
        </div>
      ) : (
        <div className="space-y-6">
          {showLoveBreakdown && contest.group_id && totalLoveVotes > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>真爱票统计</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-sm text-muted-foreground">
                  总真爱票使用数量：{totalLoveVotes}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {results
                    .filter((result) => result.loveVoteCount > 0)
                    .map((result) => (
                      <div
                        key={result.candidateId}
                        className="rounded-2xl border border-[#FFB3C1] bg-[#FFE4EA]/70 p-3 text-sm"
                      >
                        <div className="font-medium">{result.name}</div>
                        <div className="mt-1 text-muted-foreground">
                          真爱票 {result.loveVoteCount} 张，真爱票得分{" "}
                          {result.loveScore}
                        </div>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {results.length > 0 ? (
            <ResultList
              results={results}
              showImage={contest.show_candidate_image}
              showDescription={contest.show_candidate_description}
              showNominatorInfo={contest.show_nominator_info}
              showLoveBreakdown={showLoveBreakdown}
            />
          ) : (
            <div className="rounded-2xl border p-8 text-muted-foreground">
              暂无候选项或投票。候选项和有效投票产生后会显示结果。
            </div>
          )}
        </div>
      )}

      <Button asChild variant="outline" className="mt-8">
        <Link href={`/contests/${contest.id}`}>返回活动</Link>
      </Button>
    </div>
  );
}
