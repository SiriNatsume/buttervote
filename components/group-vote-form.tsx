"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Heart, ImageIcon, Send } from "lucide-react";
import { toast } from "sonner";
import { submitGroupVotes } from "@/lib/actions/group-actions";
import { toUserFacingError } from "@/lib/action-error";
import { getPublicImageUrl } from "@/lib/image/image-url";
import type { Candidate, Contest, ContestGroup } from "@/lib/types";
import { cn } from "@/lib/utils";
import { LoveVoteConfirmDialog } from "@/components/love-vote-confirm-dialog";
import { LoveVoteSupplementPanel } from "@/components/love-vote-supplement-panel";
import { StatusBadge, VoteTypeBadge } from "@/components/contest-badges";
import { LoadingButton } from "@/components/loading-button";
import { Badge } from "@/components/ui/badge";
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

type ContestSelection = {
  candidateId: string;
  candidateIds: string[];
  ranking: string[];
  loveCandidateIds: string[];
};

function emptySelection(): ContestSelection {
  return {
    candidateId: "",
    candidateIds: [],
    ranking: ["", "", ""],
    loveCandidateIds: [],
  };
}

function selectedIdsForContest(contest: GroupVoteContest, selection: ContestSelection) {
  if (contest.vote_type === "single") {
    return selection.candidateId ? [selection.candidateId] : [];
  }

  if (contest.vote_type === "multiple") {
    return selection.candidateIds;
  }

  return selection.ranking.filter(Boolean);
}

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
  const loveVoteRemaining = Math.max(0, group.love_vote_quota - usedLoveVotes);
  const loveVoteEnabledForGroup =
    group.love_vote_quota > 0 && Number(group.love_vote_weight) > 1;
  const selectedLoveCount = useMemo(
    () =>
      Object.values(selections).reduce(
        (total, selection) => total + selection.loveCandidateIds.length,
        0,
      ),
    [selections],
  );
  const availableLoveVotes = Math.max(0, loveVoteRemaining - selectedLoveCount);
  const unvotedContests = contests.filter(
    (contest) => !contest.existingVoteId && contest.candidates.length > 0,
  );
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
  const loveCandidateNames = useMemo(
    () =>
      Object.values(selections)
        .flatMap((selection) => selection.loveCandidateIds)
        .map((candidateId) => candidateNameById.get(candidateId) ?? "未知选项"),
    [candidateNameById, selections],
  );

  function getSelection(contestId: string) {
    return selections[contestId] ?? emptySelection();
  }

  function updateSelection(
    contest: GroupVoteContest,
    updater: (selection: ContestSelection) => ContestSelection,
  ) {
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

    const exactChoiceContest = unvotedContests.find((contest) => {
      if (
        contest.vote_type !== "multiple" ||
        contest.require_exact_choices !== true
      ) {
        return false;
      }

      return (
        selectedIdsForContest(contest, getSelection(contest.id)).length !==
        contest.max_choices
      );
    });

    if (exactChoiceContest) {
      return {
        ok: false as const,
        error: `「${exactChoiceContest.title}」需要选择 ${exactChoiceContest.max_choices} 项。`,
      };
    }

    const incompleteContest = unvotedContests.find(
      (contest) => selectedIdsForContest(contest, getSelection(contest.id)).length === 0,
    );

    if (incompleteContest) {
      return {
        ok: false as const,
        error: `请先完成「${incompleteContest.title}」的投票。`,
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    setError(null);

    const prepared = prepareVotes();
    if (!prepared.ok) {
      setError(prepared.error);
      toast.error(prepared.error);
      return;
    }

    const hasLoveVotes = prepared.votes.some(
      (vote) => vote.loveCandidateIds.length > 0,
    );

    if (hasLoveVotes) {
      setConfirmOpen(true);
      return;
    }

    await submitPreparedVotes();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <fieldset disabled={isSubmitting} className="space-y-6 disabled:opacity-70">
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
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

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

      {contests.map((contest) => {
        const selection = getSelection(contest.id);
        const selectedRanking = selection.ranking.filter(Boolean);
        const realtimeScores = realtimeScoresByContestId?.[contest.id];

        return (
          <Card
            key={contest.id}
            id={`group-vote-contest-${contest.id}`}
            className={cn(
              "scroll-mt-24",
              isSubmitting ? "pointer-events-none" : "",
            )}
          >
            <CardHeader>
              <div className="mb-2 flex flex-wrap gap-2">
                <StatusBadge status={contest.status} />
                <VoteTypeBadge voteType={contest.vote_type} />
                {contest.existingVoteId ? (
                  <Badge variant="secondary">已投票</Badge>
                ) : null}
              </div>
              <CardTitle>{contest.title}</CardTitle>
            </CardHeader>
            <CardContent>
              {contest.existingVoteId ? (
                <div className="rounded-2xl border p-4 text-sm text-muted-foreground">
                  你已经在这个活动中投过票。
                </div>
              ) : contest.candidates.length === 0 ? (
                <div className="rounded-2xl border border-[#EED8AA]/70 bg-[#FFF8E8]/70 p-4 text-sm text-muted-foreground">
                  当前活动暂无候选项，暂时不能提交这一项投票。
                </div>
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
                          <SelectTrigger>
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
      })}

      <LoadingButton
        type="submit"
        disabled={unvotedContests.length === 0}
        loading={isSubmitting}
        loadingText="正在提交组内投票..."
      >
        <Send className="size-4" />
        提交组内投票
      </LoadingButton>
      </fieldset>
      <LoveVoteConfirmDialog
        open={confirmOpen}
        candidateNames={loveCandidateNames}
        loading={isSubmitting}
        onOpenChange={(open) => {
          if (!isSubmitting) {
            setConfirmOpen(open);
          }
        }}
        onConfirm={() => {
          setConfirmOpen(false);
          void submitPreparedVotes();
        }}
      />
    </form>
  );
}
