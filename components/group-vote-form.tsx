"use client";

import { FormEvent, Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, ChevronRight, ClipboardCheck, Heart, ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { submitGroupVotes } from "@/lib/actions/group-actions";
import { toUserFacingError } from "@/lib/action-error";
import { getPublicImageUrl } from "@/lib/image/image-url";
import {
  emptySelection,
  groupVoteContests,
  isContestSelectionComplete,
  selectedIdsForContest,
  type ContestSelection,
} from "@/lib/group-vote-progress";
import type { Candidate, Contest, ContestGroup } from "@/lib/types";
import { cn } from "@/lib/utils";
import { GroupVoteReviewDialog } from "@/components/group-vote-review-dialog";
import { LoveVoteSupplementPanel } from "@/components/love-vote-supplement-panel";
import { MascotEmptyState } from "@/components/mascot";
import { StatusBadge, VoteTypeBadge } from "@/components/contest-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type GroupVoteContest = Pick<
  Contest,
  | "id"
  | "title"
  | "status"
  | "vote_type"
  | "max_choices"
  | "require_exact_choices"
  | "show_candidate_image"
  | "show_candidate_description"
  | "show_nominator_info"
  | "love_vote_enabled"
>;

type GroupVoteCandidate = Pick<
  Candidate,
  "id" | "contest_id" | "name" | "description" | "image_path" | "nominator_display_name"
>;

type ContestWithCandidates = GroupVoteContest & {
  candidates: GroupVoteCandidate[];
  existingVoteId?: string | null;
  selectedCandidateIds?: string[];
  alreadyLoveCandidateIds?: string[];
};

const STEP_BUTTON_CLASS_NAME =
  "step inline-flex h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl border px-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm";
const STEP_DOT_CLASS_NAME =
  "step-dot flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] leading-none tabular-nums";

function CandidateImage({
  candidate,
  show,
}: {
  candidate: GroupVoteCandidate;
  show: boolean;
}) {
  const imageUrl = getPublicImageUrl(candidate.image_path);

  if (!show) {
    return null;
  }

  return (
    <span className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted">
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={`${candidate.name} 图片`}
          className="size-full object-cover"
        />
      ) : (
        <span className="butter-placeholder flex size-full items-center justify-center">
          <ImageIcon className="size-5" aria-hidden="true" />
        </span>
      )}
    </span>
  );
}

function CandidateInfo({
  contest,
  candidate,
  compact = false,
}: {
  contest: GroupVoteContest;
  candidate: GroupVoteCandidate;
  compact?: boolean;
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className="font-medium">{candidate.name}</div>
      {contest.show_candidate_description ? (
        <div
          className={
            compact
              ? "line-clamp-2 text-sm leading-5 text-muted-foreground"
              : "mt-1 text-sm font-normal leading-6 text-muted-foreground"
          }
        >
          {candidate.description || "暂无简介。"}
        </div>
      ) : null}
      {contest.show_nominator_info && candidate.nominator_display_name ? (
        <div className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
          <div>提名者：{candidate.nominator_display_name}</div>
        </div>
      ) : null}
    </div>
  );
}

function RealtimeScoreBlock({ score }: { score?: number }) {
  if (typeof score !== "number") {
    return null;
  }

  return (
    <div className="ml-auto shrink-0 text-right text-sm">
      <div className="text-2xl font-semibold">{score}</div>
      <div className="text-muted-foreground">实时总分</div>
    </div>
  );
}

function RealtimeScoreNote({ score }: { score?: number }) {
  if (typeof score !== "number") {
    return null;
  }

  return (
    <div className="mt-3 text-right text-[11px] leading-4 text-muted-foreground">
      实时总分不含真爱票
    </div>
  );
}

export function GroupVoteForm({
  group,
  contests,
  usedLoveVotes,
  realtimeScoresByContestId,
}: {
  group: Pick<
    ContestGroup,
    "id" | "name" | "love_vote_quota" | "love_vote_weight"
  >;
  contests: ContestWithCandidates[];
  usedLoveVotes: number;
  realtimeScoresByContestId?: Record<string, Record<string, number>>;
}) {
  const router = useRouter();
  const [selections, setSelections] = useState<Record<string, ContestSelection>>(
    {},
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeContestId, setActiveContestId] = useState<string | null>(null);
  const stepRailRef = useRef<HTMLDivElement>(null);
  const loveVoteRemaining = Math.max(0, group.love_vote_quota - usedLoveVotes);
  const loveVoteEnabledForGroup =
    group.love_vote_quota > 0 && Number(group.love_vote_weight) > 1;
  const selectedLoveCount = useMemo(
    () =>
      contests.reduce((total, contest) =>
        total + (!contest.existingVoteId && contest.candidates.length > 0
          ? (selections[contest.id]?.loveCandidateIds.length ?? 0)
          : 0), 0),
    [contests, selections],
  );
  const availableLoveVotes = Math.max(0, loveVoteRemaining - selectedLoveCount);
  const {
    pending: unvotedContests,
    unavailable: unavailableContests,
    voted: votedContests,
  } = groupVoteContests(contests);
  const completedCount = unvotedContests.filter((contest) =>
    isContestSelectionComplete(contest, selections[contest.id] ?? emptySelection()),
  ).length;
  const firstIncompleteContest = unvotedContests.find((contest) =>
    !isContestSelectionComplete(contest, selections[contest.id] ?? emptySelection()),
  );
  const currentContestId = unvotedContests.some((contest) => contest.id === activeContestId)
    ? activeContestId
    : firstIncompleteContest?.id;

  useEffect(() => {
    const rail = stepRailRef.current;
    const step = document.getElementById(`group-vote-step-${currentContestId}`);
    if (!rail || !step) return;
    const railBounds = rail.getBoundingClientRect();
    const stepBounds = step.getBoundingClientRect();
    if (stepBounds.left < railBounds.left) {
      rail.scrollBy({ left: stepBounds.left - railBounds.left });
    } else if (stepBounds.right > railBounds.right) {
      rail.scrollBy({ left: stepBounds.right - railBounds.right });
    }
  }, [currentContestId]);
  const supplementContests = useMemo(
    () =>
      contests
        .filter(
          (contest) =>
            contest.existingVoteId &&
            contest.love_vote_enabled !== false &&
            (contest.selectedCandidateIds ?? []).length > 0,
        )
        .map((contest) => {
          const selectedSet = new Set(contest.selectedCandidateIds ?? []);
          return {
            ...contest,
            candidates: contest.candidates.filter((candidate) =>
              selectedSet.has(candidate.id),
            ),
            alreadyLoveCandidateIds: contest.alreadyLoveCandidateIds ?? [],
          };
        })
        .filter((contest) => contest.candidates.length > 0),
    [contests],
  );
  const candidateNameById = useMemo(() => {
    const entries = contests.flatMap((contest) =>
      contest.candidates.map((candidate) => [candidate.id, candidate.name] as const),
    );
    return new Map(entries);
  }, [contests]);
  const reviewItems = unvotedContests.map((contest) => {
    const selection = selections[contest.id] ?? emptySelection();
    return {
      contestId: contest.id,
      title: contest.title,
      voteType: contest.vote_type,
      choices: selectedIdsForContest(contest, selection).map((id) => ({
        id,
        name: candidateNameById.get(id) ?? "未知选项",
        love: selection.loveCandidateIds.includes(id),
      })),
    };
  });

  function jumpToContest(contestId: string) {
    setActiveContestId(contestId);
    const target = document.getElementById(`group-vote-contest-${contestId}`);
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
      block: "start",
    });
  }

  function getSelection(contestId: string) {
    return selections[contestId] ?? emptySelection();
  }

  function updateSelection(
    contest: GroupVoteContest,
    updater: (selection: ContestSelection) => ContestSelection,
  ) {
    setError(null);
    setSelections((current) => {
      const nextSelection = updater(current[contest.id] ?? emptySelection());
      const selectedIds = new Set(selectedIdsForContest(contest, nextSelection));
      return {
        ...current,
        [contest.id]: {
          ...nextSelection,
          loveCandidateIds: nextSelection.loveCandidateIds.filter((candidateId) =>
            selectedIds.has(candidateId),
          ),
        },
      };
    });
  }

  function toggleLove(
    contest: GroupVoteContest,
    candidateId: string,
    checked: boolean,
  ) {
    updateSelection(contest, (selection) => {
      const selectedIds = new Set(selectedIdsForContest(contest, selection));
      if (!selectedIds.has(candidateId)) {
        return selection;
      }

      if (checked) {
        if (
          selection.loveCandidateIds.includes(candidateId)
        ) {
          return selection;
        }

        if (selectedLoveCount >= loveVoteRemaining) {
          toast.error("剩余真爱票不足");
          return selection;
        }

        return {
          ...selection,
          loveCandidateIds: [...selection.loveCandidateIds, candidateId],
        };
      }

      return {
        ...selection,
        loveCandidateIds: selection.loveCandidateIds.filter(
          (id) => id !== candidateId,
        ),
      };
    });
  }

  function renderLoveCheckbox(contest: GroupVoteContest, candidateId: string) {
    if (!loveVoteEnabledForGroup || contest.love_vote_enabled === false) {
      return null;
    }

    const selection = getSelection(contest.id);
    const selectedIds = new Set(selectedIdsForContest(contest, selection));
    const checked = selection.loveCandidateIds.includes(candidateId);
    const disabled = !selectedIds.has(candidateId);

    return (
      <div
        className={cn(
          "mt-3 inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm",
          checked
            ? "border-[#FFB3C1] bg-[#FFE4EA] text-[#C73555]"
            : "border-[#F1D6A1] bg-white/50 text-muted-foreground",
        )}
      >
        <Checkbox
          aria-label={`为${candidateNameById.get(candidateId) ?? "该候选项"}使用真爱票`}
          checked={checked}
          disabled={disabled}
          onCheckedChange={(value) => toggleLove(contest, candidateId, value === true)}
        />
        <Heart className={cn("size-4 transition-transform", checked && "fill-current scale-110 animate-pulse")} />
        真爱票
      </div>
    );
  }

  function prepareVotes() {
    const votes = unvotedContests.map((contest) => {
      const selection = getSelection(contest.id);

      if (contest.vote_type === "single") {
        return {
          contestId: contest.id,
          payload: { candidateId: selection.candidateId },
          loveCandidateIds: selection.loveCandidateIds,
        };
      }

      if (contest.vote_type === "multiple") {
        return {
          contestId: contest.id,
          payload: { candidateIds: selection.candidateIds },
          loveCandidateIds: selection.loveCandidateIds,
        };
      }

      return {
        contestId: contest.id,
        payload: { ranking: selection.ranking.filter(Boolean) },
        loveCandidateIds: selection.loveCandidateIds,
      };
    });

    const incompleteContest = unvotedContests.find(
      (contest) => !isContestSelectionComplete(contest, getSelection(contest.id)),
    );

    if (incompleteContest) {
      return {
        ok: false as const,
        error: incompleteContest.vote_type === "multiple" && incompleteContest.require_exact_choices === true
          ? `「${incompleteContest.title}」需要选择 ${incompleteContest.max_choices} 项。`
          : `请先完成「${incompleteContest.title}」的投票。`,
      };
    }

    if (votes.length === 0) {
      return { ok: false as const, error: "没有需要提交的新投票。" };
    }

    return { ok: true as const, votes };
  }

  async function submitPreparedVotes() {
    if (isSubmitting) {
      return;
    }

    const prepared = prepareVotes();

    if (!prepared.ok) {
      setError(prepared.error);
      toast.error(prepared.error);
      return;
    }

    setError(null);
    setIsSubmitting(true);
    let keepSubmitting = false;
    try {
      const response = await submitGroupVotes({
        groupId: group.id,
        votes: prepared.votes,
      });

      if (!response.ok) {
        const message = toUserFacingError(response.error ?? "提交组内投票失败。");
        setError(message);
        toast.error(message);
        return;
      }

      toast.success("组内投票提交成功");
      keepSubmitting = true;
      router.push(`/groups/${group.id}`);
      router.refresh();
    } catch (nextError) {
      const message = toUserFacingError(
        nextError instanceof Error ? nextError.message : undefined,
      );
      setError(message);
      toast.error(message);
    } finally {
      if (!keepSubmitting) {
        setIsSubmitting(false);
      }
    }
  }

  function reviewVotes() {
    if (isSubmitting) {
      return;
    }

    setError(null);

    const prepared = prepareVotes();
    if (!prepared.ok) {
      setError(prepared.error);
      toast.error(prepared.error);
      if (firstIncompleteContest) jumpToContest(firstIncompleteContest.id);
      return;
    }

    setConfirmOpen(true);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    reviewVotes();
  }

  function renderContest(contest: ContestWithCandidates, index?: number) {
    const selection = getSelection(contest.id);
    const selectedRanking = selection.ranking.filter(Boolean);
    const realtimeScores = realtimeScoresByContestId?.[contest.id];

    return (
      <Card
        key={contest.id}
        id={`group-vote-contest-${contest.id}`}
        tabIndex={-1}
        aria-labelledby={`group-vote-title-${contest.id}`}
        onFocusCapture={() => {
          if (!contest.existingVoteId) setActiveContestId(contest.id);
        }}
        className={cn(
          "scroll-mt-[calc(var(--site-header-height)+9rem)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isSubmitting ? "pointer-events-none" : "",
        )}
      >
        <CardHeader>
          <div className="mb-2 flex flex-wrap gap-2">
            {index !== undefined ? (
              <span className="mr-auto text-sm font-medium text-muted-foreground">第 {index + 1} 场</span>
            ) : null}
            <StatusBadge status={contest.status} />
            <VoteTypeBadge voteType={contest.vote_type} />
            {contest.existingVoteId ? (
              <Badge variant="secondary">已投票</Badge>
            ) : null}
          </div>
          <CardTitle id={`group-vote-title-${contest.id}`}>{contest.title}</CardTitle>
        </CardHeader>
        <CardContent>
          {contest.existingVoteId ? (
            <div className="space-y-2 rounded-2xl border bg-[#F0F5EB]/60 p-4 text-sm">
              <p className="text-muted-foreground">你已经在这个活动中投过票。</p>
              {(contest.selectedCandidateIds ?? []).length > 0 ? (
                <ul className="space-y-1.5">
                  {(contest.selectedCandidateIds ?? []).map((candidateId, choiceIndex) => (
                    <li key={candidateId} className="flex flex-wrap items-center gap-2">
                      {contest.vote_type === "ranked" ? <span className="text-muted-foreground">第 {choiceIndex + 1} 名</span> : null}
                      <span>{candidateNameById.get(candidateId) ?? "已投候选项"}</span>
                      {contest.alreadyLoveCandidateIds?.includes(candidateId) ? (
                        <span className="inline-flex items-center gap-1 text-xs text-[#C73555]">
                          <Heart className="size-3 fill-current" aria-hidden="true" />真爱票
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : contest.candidates.length === 0 ? (
            <MascotEmptyState
              kind="emptyCandidates"
              title="当前活动暂无候选项"
              compact
              imageClassName="h-20 w-20 sm:h-24 sm:w-24"
            >
              暂时不能提交这一项投票。
            </MascotEmptyState>
          ) : contest.vote_type === "single" ? (
            <RadioGroup
              value={selection.candidateId}
              onValueChange={(candidateId) =>
                updateSelection(contest, (current) => ({
                  ...current,
                  candidateId,
                }))
              }
              className="gap-3"
            >
              {contest.candidates.map((candidate) => (
                  <Label
                    key={candidate.id}
                    className={cn(
                      "butter-option block cursor-pointer rounded-2xl border p-4",
                      selection.candidateId === candidate.id &&
                        "butter-option-selected scale-[1.01]",
                    )}
                  >
                  <div className="flex items-start gap-3">
                    <RadioGroupItem value={candidate.id} className="mt-5" />
                    <CandidateImage
                      candidate={candidate}
                      show={contest.show_candidate_image}
                    />
                    <CandidateInfo
                      contest={contest}
                      candidate={candidate}
                    />
                    <RealtimeScoreBlock score={realtimeScores?.[candidate.id]} />
                  </div>
                  {renderLoveCheckbox(contest, candidate.id)}
                  <RealtimeScoreNote score={realtimeScores?.[candidate.id]} />
                </Label>
              ))}
            </RadioGroup>
          ) : contest.vote_type === "multiple" ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {contest.require_exact_choices === true
                  ? `必须选择 ${contest.max_choices} 项。`
                  : `最多选择 ${contest.max_choices} 项。`}
              </p>
              {contest.candidates.map((candidate) => {
                const checked = selection.candidateIds.includes(candidate.id);
                const disabled =
                  !checked && selection.candidateIds.length >= contest.max_choices;

                return (
                  <Label
                    key={candidate.id}
                    className={cn(
                      "butter-option block cursor-pointer rounded-2xl border p-4",
                      checked && "butter-option-selected scale-[1.01]",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={checked}
                        disabled={disabled}
                        onCheckedChange={(value) =>
                          updateSelection(contest, (current) => ({
                            ...current,
                            candidateIds:
                              value === true
                                ? [...current.candidateIds, candidate.id]
                                : current.candidateIds.filter(
                                    (id) => id !== candidate.id,
                                  ),
                          }))
                        }
                        className="mt-5"
                      />
                      <CandidateImage
                        candidate={candidate}
                        show={contest.show_candidate_image}
                      />
                      <CandidateInfo
                        contest={contest}
                        candidate={candidate}
                      />
                      <RealtimeScoreBlock score={realtimeScores?.[candidate.id]} />
                    </div>
                    {renderLoveCheckbox(contest, candidate.id)}
                    <RealtimeScoreNote score={realtimeScores?.[candidate.id]} />
                  </Label>
                );
              })}
            </div>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2">
                {contest.candidates.map((candidate) => (
                  <div
                    key={candidate.id}
                    className={cn(
                      "butter-option rounded-2xl border p-3",
                      selectedRanking.includes(candidate.id) &&
                        "butter-option-selected scale-[1.01]",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <CandidateImage
                        candidate={candidate}
                        show={contest.show_candidate_image}
                      />
                      <CandidateInfo
                        contest={contest}
                        candidate={candidate}
                        compact
                      />
                      <RealtimeScoreBlock score={realtimeScores?.[candidate.id]} />
                    </div>
                    {renderLoveCheckbox(contest, candidate.id)}
                    <RealtimeScoreNote score={realtimeScores?.[candidate.id]} />
                  </div>
                ))}
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                {[0, 1, 2].map((rankIndex) => (
                  <div key={rankIndex} className="space-y-2">
                    <Label>第 {rankIndex + 1} 名</Label>
                    <Select
                      value={selection.ranking[rankIndex]}
                      onValueChange={(value) =>
                        updateSelection(contest, (current) => ({
                          ...current,
                          ranking: current.ranking.map((item, index) =>
                            index === rankIndex ? value : item,
                          ),
                        }))
                      }
                    >
                        <SelectTrigger aria-label={`第 ${rankIndex + 1} 名候选项`}>
                        <SelectValue placeholder="选择候选项" />
                      </SelectTrigger>
                      <SelectContent>
                        {contest.candidates.map((candidate) => (
                          <SelectItem
                            key={candidate.id}
                            value={candidate.id}
                            disabled={
                              selectedRanking.includes(candidate.id) &&
                              selection.ranking[rankIndex] !== candidate.id
                            }
                          >
                            {candidate.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <fieldset disabled={isSubmitting} className="min-w-0 space-y-6 disabled:opacity-70">
        {unvotedContests.length > 0 ? (
          <div className="sticky top-[calc(var(--site-header-height)+0.5rem)] z-20 rounded-2xl border bg-[#FFFCF4]/95 p-3 shadow-sm backdrop-blur-sm sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs sm:text-sm">
              <p role="status" aria-live="polite" aria-atomic="true">
                已选 <strong className="tabular-nums">{completedCount} / {unvotedContests.length}</strong> 场
                {votedContests.length > 0 ? <span className="ml-2 text-muted-foreground">另有 {votedContests.length} 场已投票</span> : null}
              </p>
              <span className="text-muted-foreground">本次使用真爱票 {selectedLoveCount} 张</span>
            </div>
            <nav className="steps flex items-center gap-1.5" aria-label="填写进度">
              <div ref={stepRailRef} className="flex h-12 min-w-0 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {unvotedContests.map((contest, index) => {
                const done = isContestSelectionComplete(contest, getSelection(contest.id));
                const active = currentContestId === contest.id;
                return (
                  <Fragment key={contest.id}>
                    {index > 0 ? <ChevronRight className="step-arrow size-4 shrink-0 text-[#B8A58F]" aria-hidden="true" /> : null}
                    <button
                      type="button"
                      id={`group-vote-step-${contest.id}`}
                      title={contest.title}
                      aria-label={`第 ${index + 1} 场：${contest.title}，${done ? "已选择" : "待完成"}`}
                      aria-current={active && !confirmOpen ? "step" : undefined}
                      aria-controls={`group-vote-contest-${contest.id}`}
                      onClick={() => jumpToContest(contest.id)}
                      className={cn(
                        STEP_BUTTON_CLASS_NAME,
                        done
                          ? "done border-[#DDE7D7] bg-[#F0F5EB] text-[#526C53]"
                          : active
                            ? "active border-[#D99E6B] bg-[#FFF4DF] text-[#AE4621]"
                            : "border-border bg-white/60 text-muted-foreground",
                      )}
                    >
                      <span className={cn(
                        STEP_DOT_CLASS_NAME,
                        done ? "bg-[#DFE9D9]" : active ? "bg-[#F97316] text-white" : "bg-[#EEE7DC]",
                      )}>
                        {done ? <Check className="size-3.5" aria-hidden="true" /> : index + 1}
                      </span>
                      第 {index + 1} 场
                    </button>
                  </Fragment>
                );
              })}
              </div>
              <ChevronRight className="step-arrow size-4 shrink-0 text-[#B8A58F]" aria-hidden="true" />
              <button
                type="button"
                onClick={reviewVotes}
                aria-current={confirmOpen ? "step" : undefined}
                className={cn(
                  STEP_BUTTON_CLASS_NAME,
                  completedCount === unvotedContests.length
                    ? "active border-[#D99E6B] bg-[#FFF4DF] text-[#AE4621]"
                    : "border-border bg-white/60 text-muted-foreground",
                )}
              >
                <span className={cn(
                  STEP_DOT_CLASS_NAME,
                  completedCount === unvotedContests.length ? "bg-[#F97316] text-white" : "bg-[#EEE7DC]",
                )}>{unvotedContests.length + 1}</span>
                核对选票
              </button>
            </nav>
            <Progress className="mt-2 h-1" value={completedCount / unvotedContests.length * 100} aria-label="本次选票填写进度" />
          </div>
        ) : null}
        <Card>
          <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-[#FFB3C1] bg-[#FFE4EA] px-3 py-1 text-sm font-medium text-[#C73555]">
                <Heart className="size-4 fill-current" />
                真爱票
              </div>
              <div className="mt-3 text-2xl font-semibold">
                还可使用 {availableLoveVotes} 张
              </div>
            </div>
            <div className="text-sm text-muted-foreground">
              权重 x{group.love_vote_weight} · 总额度 {group.love_vote_quota} · 已用{" "}
              {usedLoveVotes}
            </div>
          </CardContent>
        </Card>

        {error ? (
          <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {unvotedContests.map((contest, index) => renderContest(contest, index))}

        {unvotedContests.length > 0 ? (
          <div className="flex flex-col gap-4 rounded-2xl border bg-[#FFFCF4] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div className="space-y-1">
              <p className="text-sm font-medium">已完成 {completedCount} / {unvotedContests.length} 场选择</p>
              <p className="text-xs leading-5 text-muted-foreground">核对候选项和真爱票后再确认提交。提交后不可修改或撤回。</p>
            </div>
            <Button type="submit" variant={selectedLoveCount > 0 ? "loveParticipation" : "participation"} className="shrink-0">
              {firstIncompleteContest ? <ArrowRight className="size-4" aria-hidden="true" /> : <ClipboardCheck className="size-4" aria-hidden="true" />}
              {firstIncompleteContest ? "继续选择" : "核对并提交"}
            </Button>
          </div>
        ) : votedContests.length > 0 ? (
          <p role="status" className="flex items-center gap-2 rounded-2xl border border-[#DDE7D7] bg-[#F0F5EB] p-4 text-sm text-[#526C53]">
            <Check className="size-4 shrink-0" aria-hidden="true" />
            当前可投活动均已完成，可在下方查看已投选票。
          </p>
        ) : null}

        {unavailableContests.length > 0 ? (
          <section className="space-y-4" aria-label="暂不可投的活动">
            <h2 className="text-sm font-medium text-muted-foreground">暂不可投的活动 · {unavailableContests.length} 场</h2>
            {unavailableContests.map((contest) => renderContest(contest))}
          </section>
        ) : null}

        {votedContests.length > 0 ? (
          <details className="group space-y-4 rounded-2xl border bg-[#FFFCF4]/60 p-4 sm:p-5" open={unvotedContests.length === 0}>
            <summary className="flex cursor-pointer list-none items-center gap-3 rounded-lg text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              <Check className="size-4 text-[#526C53]" aria-hidden="true" />
              已投票的活动 · {votedContests.length} 场
              <ChevronRight className="ml-auto size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />
            </summary>
            <p className="text-xs leading-5 text-muted-foreground">已提交的选票保留在这里。活动允许时，可为已选候选项补投真爱票。</p>
            {votedContests.map((contest) => renderContest(contest))}
            {supplementContests.length > 0 ? (
              <LoveVoteSupplementPanel
                groupId={group.id}
                quota={group.love_vote_quota}
                weight={Number(group.love_vote_weight)}
                used={usedLoveVotes}
                reservedLoveVotes={selectedLoveCount}
                contests={supplementContests}
              />
            ) : null}
          </details>
        ) : null}
      </fieldset>
      <GroupVoteReviewDialog
        open={confirmOpen}
        items={reviewItems}
        loveVoteCount={selectedLoveCount}
        loveVoteWeight={Number(group.love_vote_weight)}
        availableLoveVotes={availableLoveVotes}
        loading={isSubmitting}
        error={error}
        onOpenChange={(open) => {
          if (!isSubmitting) {
            setConfirmOpen(open);
          }
        }}
        onEdit={jumpToContest}
        onConfirm={() => {
          void submitPreparedVotes();
        }}
      />
    </form>
  );
}
