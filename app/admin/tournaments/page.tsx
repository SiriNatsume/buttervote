import Link from "next/link";
import {
  ArrowLeft,
  ChevronRight,
  ExternalLink,
  ListChecks,
  Shuffle,
} from "lucide-react";
import {
  CreateTournamentForm,
  GenerateKnockoutForm,
  GenerateNextKnockoutRoundForm,
  GeneratePreliminaryForm,
  GenerateTiebreakersForm,
  RetractTournamentDrawDialog,
} from "@/components/tournament-tool-forms";
import { StatusBadge, VoteTypeBadge } from "@/components/contest-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth";
import { createRequiredServiceClient } from "@/lib/supabase/service";
import { fetchAllRows } from "@/lib/supabase-pagination";
import { tallyVotes, type TallyResult } from "@/lib/tally";
import { formatDateTime } from "@/lib/time";
import {
  resolveScreeningAdvancers,
  type ScreeningBoundary,
} from "@/lib/tournament-rules";
import { getTournamentDrawRetractionTarget } from "@/lib/tournament-retraction";
import type {
  Contest,
  ContestGroup,
  LoveVoteAllocation,
  Tournament,
  TournamentDrawLog,
  TournamentStage,
  Vote,
} from "@/lib/types";

type ContestOption = Pick<
  Contest,
  "id" | "title" | "status" | "vote_type" | "group_id" | "archived_at"
>;

type TournamentPreview = {
  tournament: Tournament;
  stages: TournamentStage[];
  logs: TournamentDrawLog[];
  screeningContest: ContestOption | null;
  results: TallyResult[];
  advancers: TallyResult[];
  boundary: ScreeningBoundary<TallyResult>;
  error?: string;
};

async function tallyContest(contest: ContestOption) {
  const supabase = createRequiredServiceClient();
  const [
    { data: candidates, error: candidatesError },
    { data: votes, error: votesError },
    { data: group },
    { data: loveRows, error: loveRowsError },
  ] = await Promise.all([
    supabase
      .from("candidates")
      .select(
        "id,name,description,image_path,nominator_display_name,is_active,created_at",
      )
      .eq("contest_id", contest.id)
      .eq("is_active", true)
      .order("created_at", { ascending: true }),
    fetchAllRows<Vote>(() =>
      supabase
        .from("votes")
        .select("id,contest_id,voter_id,payload,created_at")
        .eq("contest_id", contest.id)
        .order("created_at", { ascending: true }),
    ),
    contest.group_id
      ? supabase
          .from("contest_groups")
          .select("id,love_vote_weight")
          .eq("id", contest.group_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    contest.group_id
      ? fetchAllRows<Pick<LoveVoteAllocation, "vote_id" | "candidate_id">>(() =>
          supabase
            .from("love_vote_allocations")
            .select("vote_id,candidate_id")
            .eq("contest_id", contest.id),
        )
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (candidatesError || votesError || loveRowsError) {
    throw new Error(
      candidatesError?.message ??
        votesError?.message ??
        loveRowsError?.message ??
        "读取活动结果失败。",
    );
  }

  return tallyVotes({
    voteType: contest.vote_type,
    candidates: candidates ?? [],
    votes: votes ?? [],
    loveVoteWeight: group ? Number(group.love_vote_weight) : null,
    loveAllocations:
      (loveRows ?? []) as Array<
        Pick<LoveVoteAllocation, "vote_id" | "candidate_id">
      >,
  });
}

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatKnockoutRound(value: unknown) {
  switch (value) {
    case "round_of_16":
      return "16 强";
    case "quarterfinal":
      return "8 强";
    case "semifinal":
      return "半决赛";
    case "final":
      return "冠军赛";
    case "third_place":
      return "季军赛";
    default:
      return "正赛";
  }
}

export default async function AdminTournamentsPage() {
  await requireAdmin();
  const supabase = createRequiredServiceClient();
  const [
    { data: contests },
    { data: groups },
    { data: tournaments },
    { data: stages },
    { data: logs },
  ] = await Promise.all([
    supabase
      .from("contests")
      .select("id,title,status,vote_type,group_id,archived_at,created_at")
      .is("archived_at", null)
      .order("created_at", { ascending: false }),
    supabase.from("contest_groups").select("id,name").order("created_at"),
    supabase.from("tournaments").select("*").order("created_at", {
      ascending: false,
    }),
    supabase
      .from("tournament_stages")
      .select("*")
      .order("sequence", { ascending: true }),
    supabase
      .from("tournament_draw_logs")
      .select("*")
      .order("created_at", { ascending: false }),
  ]);
  const contestById = new Map(
    ((contests ?? []) as ContestOption[]).map((contest) => [contest.id, contest]),
  );
  const stagesByTournament = new Map<string, TournamentStage[]>();
  const logsByTournament = new Map<string, TournamentDrawLog[]>();

  for (const stage of (stages ?? []) as TournamentStage[]) {
    const current = stagesByTournament.get(stage.tournament_id) ?? [];
    current.push(stage);
    stagesByTournament.set(stage.tournament_id, current);
  }

  for (const log of (logs ?? []) as TournamentDrawLog[]) {
    const current = logsByTournament.get(log.tournament_id) ?? [];
    current.push(log);
    logsByTournament.set(log.tournament_id, current);
  }

  const previews: TournamentPreview[] = await Promise.all(
    ((tournaments ?? []) as Tournament[]).map(async (tournament) => {
      const tournamentStages = stagesByTournament.get(tournament.id) ?? [];
      const activeTournamentStages = tournamentStages.filter(
        (stage) => stage.contest_id && contestById.has(stage.contest_id),
      );
      const screeningStage = activeTournamentStages.find(
        (stage) => stage.kind === "screening",
      );
      const screeningContest = screeningStage?.contest_id
        ? contestById.get(screeningStage.contest_id) ?? null
        : null;

      if (!screeningContest) {
        return {
          tournament,
          stages: activeTournamentStages,
          logs: logsByTournament.get(tournament.id) ?? [],
          screeningContest: null,
          results: [],
          advancers: [],
          boundary: resolveScreeningAdvancers<TallyResult>([], 48).boundary,
          error: "尚未关联可读取的海选活动。",
        };
      }

      try {
        const results = await tallyContest(screeningContest);
        const screeningResolution = resolveScreeningAdvancers(results, 48);

        return {
          tournament,
          stages: activeTournamentStages,
          logs: logsByTournament.get(tournament.id) ?? [],
          screeningContest,
          results,
          advancers: screeningResolution.advancers,
          boundary: screeningResolution.boundary,
        };
      } catch (error) {
        return {
          tournament,
          stages: activeTournamentStages,
          logs: logsByTournament.get(tournament.id) ?? [],
          screeningContest,
          results: [],
          advancers: [],
          boundary: resolveScreeningAdvancers<TallyResult>([], 48).boundary,
          error: error instanceof Error ? error.message : "读取海选结果失败。",
        };
      }
    }),
  );
  const contestOptions = ((contests ?? []) as ContestOption[]).filter(
    (contest) => contest.vote_type === "multiple",
  );
  const groupOptions = (groups ?? []) as Array<Pick<ContestGroup, "id" | "name">>;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-normal">赛制工具</h1>
          <p className="mt-3 text-muted-foreground">
            创建赛事、预览海选晋级名单，并生成预赛、加赛和正赛 contest。
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/admin">
            <ArrowLeft className="size-4" />
            返回后台
          </Link>
        </Button>
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle>创建赛事</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateTournamentForm contests={contestOptions} />
        </CardContent>
      </Card>

      <div className="space-y-6">
        {previews.length > 0 ? (
          previews.map((preview) => {
            const preliminaryStages = preview.stages.filter(
              (stage) => stage.kind === "preliminary",
            );
            const tiebreakerStages = preview.stages.filter(
              (stage) => stage.kind === "tiebreaker",
            );
            const knockoutStages = preview.stages.filter(
              (stage) => stage.kind === "knockout",
            );
            const canGeneratePreliminary =
              Boolean(preview.screeningContest) &&
              ["closed", "published"].includes(
                preview.screeningContest?.status ?? "",
              ) &&
              preliminaryStages.length === 0 &&
              preview.advancers.length > 0;
            const canGenerateTiebreakers =
              preliminaryStages.length > 0 &&
              tiebreakerStages.length === 0 &&
              knockoutStages.length === 0;
            const canGenerateKnockout =
              preliminaryStages.length > 0 && knockoutStages.length === 0;
            const retractionTarget = getTournamentDrawRetractionTarget({
              logs: preview.logs,
              stages: preview.stages,
              contestsById: contestById,
            });

            return (
              <Card key={preview.tournament.id} className="min-w-0 overflow-hidden">
                <details className="group min-w-0">
                  <summary className="flex cursor-pointer list-none flex-col gap-3 p-4 transition hover:bg-[#FFF8E8]/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[#FFF8E8] [&::-webkit-details-marker]:hidden sm:flex-row sm:items-start sm:justify-between sm:p-6">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <ChevronRight className="size-5 shrink-0 text-primary transition-transform group-open:rotate-90" />
                        <CardTitle className="break-words">
                          {preview.tournament.name}
                        </CardTitle>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 pl-7">
                        <Badge variant="secondary">
                          {preview.tournament.status}
                        </Badge>
                        {preview.screeningContest ? (
                          <>
                            <StatusBadge status={preview.screeningContest.status} />
                            <VoteTypeBadge
                              voteType={preview.screeningContest.vote_type}
                            />
                          </>
                        ) : null}
                        <Badge variant="outline">
                          晋级 {preview.advancers.length} 名
                        </Badge>
                        <Badge variant="outline">
                          阶段 {preview.stages.length}
                        </Badge>
                        <Badge variant="outline">
                          日志 {preview.logs.length}
                        </Badge>
                      </div>
                    </div>
                    <div className="pl-7 text-sm text-muted-foreground sm:pl-0">
                      <span className="group-open:hidden">展开详情</span>
                      <span className="hidden group-open:inline">收起详情</span>
                    </div>
                  </summary>
                  <CardContent className="min-w-0 space-y-6 overflow-x-hidden border-t border-[#EED8AA]/70 p-4 sm:p-6">
                    {preview.screeningContest ? (
                      <div className="flex min-w-0 justify-end">
                        <Button asChild variant="outline" size="sm">
                          <Link
                            href={`/contests/${preview.screeningContest.id}/results`}
                          >
                            <ExternalLink className="size-4" />
                            海选结果
                          </Link>
                        </Button>
                      </div>
                    ) : null}
                  {preview.error ? (
                    <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                      {preview.error}
                    </div>
                  ) : null}

                  {preview.boundary.isExtendedByTie ? (
                    <div className="rounded-2xl border border-[#F0D08A] bg-[#FFF8E8] p-4 text-sm text-[#6A3E21]">
                      第 48 名边界同票，额外晋级{" "}
                      {preview.boundary.extraAdvancerCount} 名；边界分数为{" "}
                      {preview.boundary.score}。
                    </div>
                  ) : null}

                  <div className="grid min-w-0 gap-4 md:grid-cols-[1fr_0.9fr]">
                    <div className="min-w-0 rounded-2xl border border-[#EED8AA]/70">
                      <div className="flex items-center justify-between border-b border-[#EED8AA]/70 px-4 py-3">
                        <div className="flex items-center gap-2 font-medium">
                          <ListChecks className="size-4 text-[#B9854C]" />
                          海选晋级名单
                        </div>
                        <Badge variant="outline">
                          {preview.advancers.length} 名
                        </Badge>
                      </div>
                      <div className="max-h-[460px] max-w-full overflow-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>排序</TableHead>
                              <TableHead>候选项</TableHead>
                              <TableHead>票数</TableHead>
                              <TableHead>最后得票</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {preview.advancers.map((result) => (
                              <TableRow key={result.candidateId}>
                                <TableCell>{result.position}</TableCell>
                                <TableCell className="font-medium">
                                  {result.name}
                                  {result.rank !== result.position ? (
                                    <span className="ml-2 text-xs text-muted-foreground">
                                      票数并列第 {result.rank} 名
                                    </span>
                                  ) : null}
                                </TableCell>
                                <TableCell>{result.score}</TableCell>
                                <TableCell className="text-xs text-muted-foreground">
                                  {formatDateTime(result.lastVoteAt)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>

                    <div className="min-w-0 space-y-4">
                      <div className="min-w-0 rounded-2xl border border-[#EED8AA]/70 p-4">
                        <div className="mb-3 flex items-center gap-2 font-medium">
                          <Shuffle className="size-4 text-[#B9854C]" />
                          生成预赛
                        </div>
                        {preliminaryStages.length > 0 ? (
                          <div className="rounded-xl border bg-[#FFF8E8]/60 p-3 text-sm text-muted-foreground">
                            已生成预赛阶段，不能重复生成。
                          </div>
                        ) : null}
                        <GeneratePreliminaryForm
                          tournamentId={preview.tournament.id}
                          groups={groupOptions}
                          disabled={!canGeneratePreliminary}
                        />
                      </div>

                      <div className="min-w-0 rounded-2xl border border-[#EED8AA]/70 p-4">
                        <div className="mb-3 flex items-center gap-2 font-medium">
                          <Shuffle className="size-4 text-[#B9854C]" />
                          生成加赛
                        </div>
                        {tiebreakerStages.length > 0 ? (
                          <div className="mb-3 rounded-xl border bg-[#FFF8E8]/60 p-3 text-sm text-muted-foreground">
                            已生成 {tiebreakerStages.length} 场预赛加赛。
                          </div>
                        ) : null}
                        <GenerateTiebreakersForm
                          tournamentId={preview.tournament.id}
                          groups={groupOptions}
                          disabled={!canGenerateTiebreakers}
                        />
                      </div>

                      <div className="min-w-0 rounded-2xl border border-[#EED8AA]/70 p-4">
                        <div className="mb-3 flex items-center gap-2 font-medium">
                          <Shuffle className="size-4 text-[#B9854C]" />
                          生成正赛
                        </div>
                        {knockoutStages.length > 0 ? (
                          <div className="mb-3 rounded-xl border bg-[#FFF8E8]/60 p-3 text-sm text-muted-foreground">
                            已生成正赛 16 强首轮。
                          </div>
                        ) : null}
                        <GenerateKnockoutForm
                          tournamentId={preview.tournament.id}
                          groups={groupOptions}
                          disabled={!canGenerateKnockout}
                        />
                      </div>

                      <div className="min-w-0 rounded-2xl border border-[#EED8AA]/70 p-4">
                        <div className="mb-3 flex items-center gap-2 font-medium">
                          <Shuffle className="size-4 text-[#B9854C]" />
                          生成下一轮正赛
                        </div>
                        <GenerateNextKnockoutRoundForm
                          tournamentId={preview.tournament.id}
                          groups={groupOptions}
                          disabled={knockoutStages.length === 0}
                        />
                      </div>

                      {preliminaryStages.length > 0 ? (
                        <div className="min-w-0 rounded-2xl border border-[#EED8AA]/70 p-4">
                          <div className="mb-3 font-medium">预赛活动</div>
                          <div className="space-y-2">
                            {preliminaryStages.map((stage) => {
                              const contest = stage.contest_id
                                ? contestById.get(stage.contest_id)
                                : null;

                              return (
                                <div
                                  key={stage.id}
                                  className="flex min-w-0 flex-col items-stretch gap-2 rounded-xl bg-[#FFF8E8]/60 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
                                >
                                  <span className="min-w-0 truncate">
                                    {String(
                                      (stage.metadata as Record<string, unknown>)
                                        .preliminaryGroup ?? "-",
                                    )}
                                    组：{contest?.title ?? "活动已删除"}
                                  </span>
                                  {stage.contest_id ? (
                                    <Button asChild size="sm" variant="outline" className="shrink-0">
                                      <Link
                                        href={`/admin/contests/${stage.contest_id}/edit`}
                                      >
                                        打开
                                      </Link>
                                    </Button>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}

                      {tiebreakerStages.length > 0 || knockoutStages.length > 0 ? (
                        <div className="min-w-0 rounded-2xl border border-[#EED8AA]/70 p-4">
                          <div className="mb-3 font-medium">加赛 / 正赛活动</div>
                          <div className="space-y-2">
                            {[...tiebreakerStages, ...knockoutStages].map((stage) => {
                              const contest = stage.contest_id
                                ? contestById.get(stage.contest_id)
                                : null;
                              const metadata = isRecord(stage.metadata)
                                ? stage.metadata
                                : {};
                              const label =
                                stage.kind === "tiebreaker"
                                  ? `加赛 ${String(
                                      metadata.preliminaryGroup ?? "-",
                                    )} 组 ${
                                      metadata.tieKind === "group_first"
                                        ? "小组第一"
                                        : metadata.tieKind === "advancement"
                                          ? "晋级名额"
                                          : ""
                                    }`
                                  : `${formatKnockoutRound(metadata.round)} ${String(
                                      metadata.matchSlot ?? "-",
                                    )} 场`;

                              return (
                                <div
                                  key={stage.id}
                                  className="flex min-w-0 flex-col items-stretch gap-2 rounded-xl bg-[#FFF8E8]/60 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
                                >
                                  <span className="min-w-0 truncate">
                                    {label}：{contest?.title ?? "活动已删除"}
                                  </span>
                                  {stage.contest_id ? (
                                    <Button asChild size="sm" variant="outline" className="shrink-0">
                                      <Link
                                        href={`/admin/contests/${stage.contest_id}/edit`}
                                      >
                                        打开
                                      </Link>
                                    </Button>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {preview.logs.length > 0 ? (
                    <div className="space-y-3">
                      <h3 className="font-medium">抽签日志</h3>
                      {preview.logs.map((log) => (
                        <div
                          key={log.id}
                          className="rounded-2xl border border-[#EED8AA]/70 bg-[#FFFCF4]/80 p-4"
                        >
                          <div className="mb-3 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                              <Badge variant="outline">{log.kind}</Badge>
                              <Badge
                                variant="secondary"
                                className="min-w-0 max-w-full shrink whitespace-normal break-all text-left"
                              >
                                seed：{log.seed}
                              </Badge>
                              <span className="text-muted-foreground">
                                {formatDateTime(log.created_at)}
                              </span>
                              {log.retracted_at ? (
                                <Badge variant="destructive">已撤回</Badge>
                              ) : null}
                            </div>
                            {retractionTarget?.log.id === log.id ? (
                              <RetractTournamentDrawDialog
                                tournamentId={preview.tournament.id}
                                drawLogId={log.id}
                                drawTitle={log.kind}
                              />
                            ) : null}
                          </div>
                          {log.retract_reason ? (
                            <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                              撤回理由：{log.retract_reason}
                            </div>
                          ) : null}
                          <div className="grid min-w-0 gap-3 lg:grid-cols-2">
                            <pre className="max-h-72 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-xl bg-[#2B2118] p-3 text-xs leading-5 text-[#FFF8E8]">
                              {formatJson(log.input)}
                            </pre>
                            <pre className="max-h-72 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-xl bg-[#2B2118] p-3 text-xs leading-5 text-[#FFF8E8]">
                              {formatJson(log.output)}
                            </pre>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </CardContent>
                </details>
              </Card>
            );
          })
        ) : (
          <div className="rounded-2xl border p-8 text-muted-foreground">
            暂无赛事。先创建赛事并关联海选活动。
          </div>
        )}
      </div>
    </div>
  );
}
