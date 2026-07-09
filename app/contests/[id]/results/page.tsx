import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ContestCallingAutoRefresh,
  type ContestCallingRefreshWatch,
} from "@/components/contest-calling-auto-refresh";
import { ContestCallingAdminPanel } from "@/components/contest-calling-admin-panel";
import { ContestCallingStage } from "@/components/contest-calling-stage";
import { ResultList } from "@/components/result-list";
import { TournamentDrawSummaryCard } from "@/components/tournament-draw-summary-card";
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
import { createRequiredServiceClient } from "@/lib/supabase/service";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { normalizeContestCallingEvent } from "@/lib/contest-calling";
import { tallyVotes } from "@/lib/tally";
import { formatDateTime } from "@/lib/time";
import { resolvePreliminaryGroup } from "@/lib/tournament-rules";
import { buildPublicDrawSummaries } from "@/lib/tournament-draw-summary";
import type { ContestCallingEvent, ContestCallingSession, LoveVoteAllocation, TournamentEntry, Vote } from "@/lib/types";

type VoteProfile = {
  id: string;
  display_name: string | null;
  email: string | null;
  qq_nickname: string | null;
  qq_user_id: string | null;
  login_provider: string | null;
};

type AdminVoteRow = Vote & {
  profile?: VoteProfile | null;
};

type PublicVoteRow = Pick<Vote, "id" | "contest_id" | "payload" | "created_at">;

type TournamentDrawLogInfo = {
  id: string;
  kind: string;
  seed: string;
  input: unknown;
  output: unknown;
  created_at: string;
  retracted_at: string | null;
  retract_reason: string | null;
};

function voterDisplayName(profile?: VoteProfile | null) {
  return (
    profile?.display_name ||
    profile?.qq_nickname ||
    profile?.email ||
    "未知用户"
  );
}

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

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
        "id,title,description,status,vote_type,group_id,show_candidate_image,show_candidate_description,show_nominator_info,live_results_enabled,closed_result_visibility,archived_at",
      )
      .eq("id", id)
      .maybeSingle(),
    getCurrentProfile(),
  ]);

  if (!contest || contest.archived_at) {
    notFound();
  }

  const isAdmin = profile?.role === "admin";
  const canReadAllVotes = canViewResults(contest, profile);
  const dataClient = isAdmin ? await createServerDataClient() : supabase;
  let callingSessionQuery = dataClient
    .from("contest_calling_sessions")
    .select(
      "id,contest_id,status,current_step,total_steps,play_mode,auto_interval_seconds,seed,metadata,created_by,started_at,completed_at,archived_at,created_at,updated_at",
    )
    .eq("contest_id", id)
    .is("archived_at", null);

  if (!isAdmin) {
    callingSessionQuery = callingSessionQuery.in("status", [
      "active",
      "paused",
      "completed",
    ]);
  }

  const { data: callingSessions } = await callingSessionQuery
    .order("created_at", { ascending: false })
    .limit(1);
  const callingSession =
    ((callingSessions?.[0] ?? null) as ContestCallingSession | null) ?? null;
  const callingCurrentStep = Math.max(
    0,
    Number(callingSession?.current_step ?? 0) || 0,
  );
  const { data: callingEventRow } =
    callingSession && callingCurrentStep > 0
      ? await dataClient
          .from("contest_calling_events")
          .select(
            "sequence,phase,candidate_id,delta_score,candidate_snapshot,scores,metadata",
          )
          .eq("session_id", callingSession.id)
          .eq("sequence", callingCurrentStep)
          .maybeSingle()
      : { data: null };
  const currentCallingEvent = callingEventRow
    ? normalizeContestCallingEvent(callingEventRow as ContestCallingEvent)
    : null;
  const callingIsPublicProgress =
    !isAdmin &&
    callingSession !== null &&
    (callingSession.status === "active" || callingSession.status === "paused");
  const callingIsCompleted = callingSession?.status === "completed";
  const canDisplayFullResults = canReadAllVotes || callingIsCompleted;
  const canGenerateCalling = contest.status === "closed" || contest.status === "published";
  const callingAutoRefreshWatches: ContestCallingRefreshWatch[] =
    !isAdmin &&
    callingSession &&
    (callingSession.status === "active" || callingSession.status === "paused")
      ? [
          {
            contestId: contest.id,
            sessionId: callingSession.id,
            status: callingSession.status,
            currentStep: callingCurrentStep,
            totalSteps: Math.max(0, Number(callingSession.total_steps) || 0),
            updatedAt: callingSession.updated_at ?? null,
          },
        ]
      : [];

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
  const { data: tournamentStage } = await supabase
    .from("tournament_stages")
    .select("id,tournament_id,kind,metadata")
    .eq("contest_id", id)
    .maybeSingle();
  const drawLogTournamentId = canReadAllVotes
    ? tournamentStage?.tournament_id ?? null
    : null;
  const { data: tournamentLogs } = drawLogTournamentId
    ? await createRequiredServiceClient()
        .from("tournament_draw_logs")
        .select("id,kind,seed,input,output,created_at,retracted_at,retract_reason")
        .eq("tournament_id", drawLogTournamentId)
        .order("created_at", { ascending: false })
    : { data: [] };
  const { data: tournamentEntries } =
    isAdmin && tournamentStage
      ? await dataClient
          .from("tournament_entries")
          .select(
            "id,tournament_id,root_candidate_id,current_candidate_id,source_candidate_id,screening_rank,preliminary_group,preliminary_rank,is_group_winner,status,created_at,updated_at",
          )
          .eq("tournament_id", tournamentStage.tournament_id)
      : { data: [] };

  let votes: Vote[] = [];
  let adminVoteRows: AdminVoteRow[] = [];
  let loveAllocations: Array<Pick<LoveVoteAllocation, "vote_id" | "candidate_id">> =
    [];

  if (isAdmin) {
    const [
      { data: voteRows, error: voteRowsError },
      { data: loveRows, error: loveRowsError },
    ] = await Promise.all([
      fetchAllRows<Vote>(() =>
        dataClient
          .from("votes")
          .select("id,contest_id,voter_id,payload,created_at")
          .eq("contest_id", id)
          .order("created_at", { ascending: true }),
      ),
      contest.group_id
        ? fetchAllRows<Pick<LoveVoteAllocation, "vote_id" | "candidate_id">>(
            () =>
              dataClient
                .from("love_vote_allocations")
                .select("vote_id,candidate_id")
                .eq("contest_id", id),
          )
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (voteRowsError || loveRowsError) {
      console.error(
        "Failed to load contest result votes.",
        voteRowsError?.message ?? loveRowsError?.message,
      );
    } else {
      const voterIds = [
        ...new Set(
          (voteRows ?? [])
            .map((vote) => vote.voter_id)
            .filter((voterId): voterId is string => Boolean(voterId)),
        ),
      ];
      const voterProfiles: VoteProfile[] = [];
      for (let index = 0; index < voterIds.length; index += 500) {
        const voterIdChunk = voterIds.slice(index, index + 500);
        const { data, error } = await fetchAllRows<VoteProfile>(() =>
          dataClient
            .from("profiles")
            .select("id,display_name,email,qq_nickname,qq_user_id,login_provider")
            .in("id", voterIdChunk),
        );
        if (error) {
          console.error("Failed to load contest voter profiles.", error.message);
          continue;
        }
        voterProfiles.push(...data);
      }
      const profileById = new Map(
        voterProfiles.map((voterProfile) => [
          voterProfile.id,
          voterProfile,
        ]),
      );

      adminVoteRows = (voteRows ?? []).map((vote) => ({
        ...vote,
        profile: vote.voter_id ? profileById.get(vote.voter_id) ?? null : null,
      }));
      votes = adminVoteRows;
      loveAllocations = loveRows ?? [];
    }
  } else if (canDisplayFullResults) {
    const publicResultClient = await createServerDataClient();
    const [
      { data: voteRows, error: voteRowsError },
      { data: loveRows, error: loveRowsError },
    ] = await Promise.all([
      fetchAllRows<PublicVoteRow>(() =>
        publicResultClient
          .from("votes")
          .select("id,contest_id,payload,created_at")
          .eq("contest_id", id)
          .order("created_at", { ascending: true }),
      ),
      contest.group_id
        ? fetchAllRows<Pick<LoveVoteAllocation, "vote_id" | "candidate_id">>(
            () =>
              publicResultClient
                .from("love_vote_allocations")
                .select("vote_id,candidate_id")
                .eq("contest_id", id),
          )
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (voteRowsError || loveRowsError) {
      console.error(
        "Failed to load public contest result votes.",
        voteRowsError?.message ?? loveRowsError?.message,
      );
    } else {
      votes = (voteRows ?? []).map((vote) => ({
        ...vote,
        voter_id: null,
      }));
      loveAllocations = loveRows ?? [];
    }
  }

  const shouldHideLoveWeight = !isAdmin && contest.status !== "published" && !callingIsCompleted;
  const results = tallyVotes({
    voteType: contest.vote_type,
    candidates: visibleCandidates,
    votes,
    loveVoteWeight: group ? Number(group.love_vote_weight) : null,
    loveVoteScoreMode: shouldHideLoveWeight ? "base" : "weighted",
    loveAllocations,
  });
  const showLoveBreakdown =
    canDisplayFullResults && !shouldHideLoveWeight && contest.status !== "voting";
  const totalLoveVotes = loveAllocations.length;
  const entryByCandidateId = new Map<string, TournamentEntry>();

  for (const entry of (tournamentEntries ?? []) as TournamentEntry[]) {
    for (const candidateId of [
      entry.current_candidate_id,
      entry.source_candidate_id,
      entry.root_candidate_id,
    ]) {
      if (candidateId) {
        entryByCandidateId.set(candidateId, entry);
      }
    }
  }

  const screeningRankByCandidate = new Map(
    results
      .map((result) => [
        result.candidateId,
        entryByCandidateId.get(result.candidateId)?.screening_rank,
      ] as const)
      .filter((item): item is readonly [string, number] => typeof item[1] === "number"),
  );
  const preliminaryResolution =
    isAdmin && tournamentStage?.kind === "preliminary"
      ? resolvePreliminaryGroup(results, screeningRankByCandidate)
      : null;
  const publicDrawSummaries =
    canReadAllVotes && tournamentStage
      ? buildPublicDrawSummaries(
          (tournamentLogs ?? []) as TournamentDrawLogInfo[],
          tournamentStage.kind,
        )
      : [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <ContestCallingAutoRefresh watches={callingAutoRefreshWatches} />
      <div className="butter-panel mb-8 p-8">
        <div className="mb-4 flex flex-wrap gap-2">
          <StatusBadge status={contest.status} />
          <VoteTypeBadge voteType={contest.vote_type} />
          {group && !shouldHideLoveWeight ? (
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

      {isAdmin ? (
        <div className="mb-6">
          <ContestCallingAdminPanel
            contestId={contest.id}
            session={callingSession}
            canGenerate={canGenerateCalling}
          />
        </div>
      ) : null}

      {callingIsPublicProgress && callingSession ? (
        <div className="space-y-6">
          <ContestCallingStage
            contestId={contest.id}
            session={callingSession}
            event={currentCallingEvent}
          />
        </div>
      ) : !canDisplayFullResults ? (
        <div className="butter-panel p-8 text-muted-foreground">
          当前活动结果暂未公开。公开后你可以在这里查看完整结果。
        </div>
      ) : (
        <div className="space-y-6">
          {callingSession ? (
            <ContestCallingStage
              contestId={contest.id}
              session={callingSession}
              event={currentCallingEvent}
            />
          ) : null}
          <TournamentDrawSummaryCard summaries={publicDrawSummaries} />

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

          {isAdmin && preliminaryResolution?.needsTiebreaker ? (
            <Card className="border-[#F0D08A] bg-[#FFF8E8]">
              <CardHeader>
                <CardTitle>需要加赛</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-[#6A3E21]">
                {preliminaryResolution.advancementTie ? (
                  <div>
                    影响晋级：第 4 名分数线出现同票，剩余{" "}
                    {preliminaryResolution.advancementTie.remainingSlots} 个名额。
                    相关候选项：
                    {preliminaryResolution.advancementTie.candidates
                      .map((candidate) => candidate.name)
                      .join("、")}
                    。
                  </div>
                ) : null}
                {preliminaryResolution.groupFirstTie ? (
                  <div>
                    影响小组第一：最高票出现同票。相关候选项：
                    {preliminaryResolution.groupFirstTie.candidates
                      .map((candidate) => candidate.name)
                      .join("、")}
                    。
                  </div>
                ) : null}
                <div>请创建 24 小时单选加赛，不要静默晋级。</div>
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
              scoreLabel={shouldHideLoveWeight ? "实时总分" : "总分"}
            />
          ) : (
            <div className="rounded-2xl border p-8 text-muted-foreground">
              暂无候选项或投票。候选项和有效投票产生后会显示结果。
            </div>
          )}

          {isAdmin && adminVoteRows.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>投票记录</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {adminVoteRows.map((vote) => (
                  <div
                    key={vote.id}
                    className="rounded-2xl border border-[#EED8AA]/70 bg-[#FFFCF4]/80 p-4 text-sm"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="space-y-1">
                        <div className="font-medium">
                          {voterDisplayName(vote.profile)}
                        </div>
                        {vote.profile?.qq_nickname ? (
                          <div className="text-muted-foreground">
                            QQ 昵称：{vote.profile.qq_nickname}
                          </div>
                        ) : null}
                        {vote.profile?.qq_user_id ? (
                          <div className="text-muted-foreground">
                            QQ：{vote.profile.qq_user_id}
                          </div>
                        ) : null}
                        {vote.profile?.email ? (
                          <div className="text-muted-foreground">
                            邮箱：{vote.profile.email}
                          </div>
                        ) : null}
                        <div className="text-xs text-muted-foreground">
                          用户 ID：{vote.profile?.id ?? vote.voter_id ?? "未知"}
                        </div>
                      </div>
                      <div className="text-muted-foreground">
                        投票时间：{formatDateTime(vote.created_at)}
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {isAdmin && tournamentStage ? (
            <Card>
              <CardHeader>
                <CardTitle>赛制排序依据</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="text-left text-muted-foreground">
                    <tr className="border-b">
                      <th className="py-2 pr-3">排序</th>
                      <th className="py-2 pr-3">候选项</th>
                      <th className="py-2 pr-3">得票</th>
                      <th className="py-2 pr-3">票数名次</th>
                      <th className="py-2 pr-3">最后得票时间</th>
                      <th className="py-2 pr-3">海选排名</th>
                      <th className="py-2 pr-3">预赛组别/排名</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((result) => {
                      const entry = entryByCandidateId.get(result.candidateId);

                      return (
                        <tr
                          key={result.candidateId}
                          className="border-b border-[#EED8AA]/60"
                        >
                          <td className="py-2 pr-3">{result.position}</td>
                          <td className="py-2 pr-3 font-medium">
                            {result.name}
                          </td>
                          <td className="py-2 pr-3">{result.score}</td>
                          <td className="py-2 pr-3">{result.rank}</td>
                          <td className="py-2 pr-3">
                            {formatDateTime(result.lastVoteAt)}
                          </td>
                          <td className="py-2 pr-3">
                            {entry?.screening_rank ?? "未记录"}
                          </td>
                          <td className="py-2 pr-3">
                            {entry?.preliminary_group ?? "未记录"}
                            {entry?.preliminary_rank
                              ? ` / 第 ${entry.preliminary_rank} 名`
                              : ""}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}

      {isAdmin && (tournamentLogs ?? []).length > 0 ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>赛制抽签日志</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {((tournamentLogs ?? []) as TournamentDrawLogInfo[]).map((log) => (
              <div
                key={log.id}
                className="rounded-2xl border border-[#EED8AA]/70 bg-[#FFFCF4]/80 p-4"
              >
                <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="outline">{log.kind}</Badge>
                  <Badge variant="secondary">seed：{log.seed}</Badge>
                  <span className="text-muted-foreground">
                    {formatDateTime(log.created_at)}
                  </span>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  <pre className="max-h-72 overflow-auto rounded-xl bg-[#2B2118] p-3 text-xs leading-5 text-[#FFF8E8]">
                    {formatJson(log.input)}
                  </pre>
                  <pre className="max-h-72 overflow-auto rounded-xl bg-[#2B2118] p-3 text-xs leading-5 text-[#FFF8E8]">
                    {formatJson(log.output)}
                  </pre>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Button asChild variant="outline" className="mt-8">
        <Link href={`/contests/${contest.id}`}>返回活动</Link>
      </Button>
    </div>
  );
}
