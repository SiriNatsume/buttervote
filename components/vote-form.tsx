"use client";

import { FormEvent, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Heart, ImageIcon, Send } from "lucide-react";
import { toast } from "sonner";
import { submitVoteAction } from "@/lib/actions/vote-actions";
import { toUserFacingError } from "@/lib/action-error";
import { getPublicImageUrl } from "@/lib/image/image-url";
import type { Candidate, Contest } from "@/lib/types";
import { cn } from "@/lib/utils";
import { LoveVoteConfirmDialog } from "@/components/love-vote-confirm-dialog";
import { MascotEmptyState } from "@/components/mascot";
import { LoadingButton } from "@/components/loading-button";
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

function CandidateThumb({
  candidate,
  show,
}: {
  candidate: VoteFormCandidate;
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

type VoteFormContest = Pick<
  Contest,
  | "id"
  | "title"
  | "vote_type"
  | "max_choices"
  | "require_exact_choices"
  | "show_candidate_image"
  | "show_candidate_description"
  | "show_nominator_info"
>;

type VoteFormCandidate = Pick<
  Candidate,
  "id" | "name" | "description" | "image_path" | "nominator_display_name"
>;

function CandidateText({
  candidate,
  showDescription,
  showNominatorInfo,
}: {
  candidate: VoteFormCandidate;
  showDescription: boolean;
  showNominatorInfo: boolean;
}) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block font-medium">{candidate.name}</span>
      {showDescription ? (
        <span className="mt-1 block text-sm font-normal leading-6 text-muted-foreground">
          {candidate.description || "暂无简介。"}
        </span>
      ) : null}
      {showNominatorInfo && candidate.nominator_display_name ? (
        <span className="mt-2 block space-y-1 text-xs font-normal leading-5 text-muted-foreground">
          <span className="block">提名者：{candidate.nominator_display_name}</span>
        </span>
      ) : null}
    </span>
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

export function VoteForm({
  contest,
  candidates,
  error,
  loveVoteInfo,
  realtimeScores,
}: {
  contest: VoteFormContest;
  candidates: VoteFormCandidate[];
  error?: string;
  loveVoteInfo?: {
    groupId: string;
    groupName: string;
    quota: number;
    weight: number;
    used: number;
  } | null;
  realtimeScores?: Record<string, number>;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [candidateId, setCandidateId] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [ranking, setRanking] = useState(["", "", ""]);
  const [loveCandidateIds, setLoveCandidateIds] = useState<string[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const selectedRanking = useMemo(() => ranking.filter(Boolean), [ranking]);
  const selectedVoteIds = useMemo(() => {
    if (contest.vote_type === "single") {
      return candidateId ? [candidateId] : [];
    }

    if (contest.vote_type === "multiple") {
      return selectedIds;
    }

    return selectedRanking;
  }, [candidateId, contest.vote_type, selectedIds, selectedRanking]);
  const candidateNameById = useMemo(
    () => new Map(candidates.map((candidate) => [candidate.id, candidate.name])),
    [candidates],
  );
  const showImage = contest.show_candidate_image;
  const showDescription = contest.show_candidate_description;
  const showNominatorInfo = contest.show_nominator_info;
  const loveVoteRemaining = loveVoteInfo
    ? Math.max(0, loveVoteInfo.quota - loveVoteInfo.used)
    : 0;
  const availableLoveVotes = Math.max(
    0,
    loveVoteRemaining - loveCandidateIds.length,
  );
  const loveCandidateNames = loveCandidateIds.map(
    (id) => candidateNameById.get(id) ?? "未知选项",
  );

  function getMultipleChoiceError() {
    if (contest.vote_type !== "multiple") {
      return null;
    }

    if (
      contest.require_exact_choices === true &&
      selectedIds.length !== contest.max_choices
    ) {
      return `该活动需要选择 ${contest.max_choices} 项。`;
    }

    if (selectedIds.length < 1) {
      return "请至少选择一个候选项。";
    }

    return null;
  }

  function toggleCandidate(candidateId: string, checked: boolean) {
    setSelectedIds((current) => {
      if (checked) {
        return current.length >= contest.max_choices
          ? current
          : [...current, candidateId];
      }

      setLoveCandidateIds((loveIds) =>
        loveIds.filter((id) => id !== candidateId),
      );
      return current.filter((id) => id !== candidateId);
    });
  }

  function toggleLove(candidateId: string, checked: boolean) {
    if (!selectedVoteIds.includes(candidateId)) {
      return;
    }

    if (checked) {
      if (loveCandidateIds.includes(candidateId)) {
        return;
      }

      if (loveCandidateIds.length >= loveVoteRemaining) {
        toast.error("剩余真爱票不足");
        return;
      }

      setLoveCandidateIds((current) => [...current, candidateId]);
      return;
    }

    setLoveCandidateIds((current) => current.filter((id) => id !== candidateId));
  }

  function renderLoveCheckbox(candidateId: string) {
    if (!loveVoteInfo) {
      return null;
    }

    const selected = selectedVoteIds.includes(candidateId);
    const checked = loveCandidateIds.includes(candidateId);
    const disabled = !selected;

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
          disabled={disabled || isSubmitting}
          onCheckedChange={(value) => toggleLove(candidateId, value === true)}
        />
        <Heart
          className={cn(
            "size-4 transition-transform",
            checked && "scale-110 fill-current",
          )}
        />
        使用真爱票
      </div>
    );
  }

  async function submitCurrentVote() {
    if (isSubmitting) {
      return;
    }

    const form = formRef.current;
    if (!form) {
      return;
    }

    setLocalError(null);
    setIsSubmitting(true);
    const formData = new FormData(form);
    for (const loveCandidateId of loveCandidateIds) {
      formData.append("loveCandidateIds", loveCandidateId);
    }

    try {
      const response = await submitVoteAction(formData);

      if (!response.ok) {
        const message = toUserFacingError(response.error);
        setIsSubmitting(false);
        setLocalError(message);
        toast.error(message);
        return;
      }

      toast.success("投票成功");
      router.push(response.redirectTo);
      router.refresh();
    } catch (nextError) {
      const message = toUserFacingError(
        nextError instanceof Error ? nextError.message : undefined,
      );
      setIsSubmitting(false);
      setLocalError(message);
      toast.error(message);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    setLocalError(null);
    const multipleChoiceError = getMultipleChoiceError();
    if (multipleChoiceError) {
      setLocalError(multipleChoiceError);
      toast.error(multipleChoiceError);
      return;
    }

    if (loveCandidateIds.length > 0) {
      setConfirmOpen(true);
      return;
    }

    void submitCurrentVote();
  }

  return (
    <form
      ref={formRef}
      className="butter-panel space-y-6 p-6"
      onSubmit={handleSubmit}
    >
      <input type="hidden" name="contestId" value={contest.id} />
      <input type="hidden" name="voteType" value={contest.vote_type} />

      <fieldset disabled={isSubmitting} className="space-y-6 disabled:opacity-70">
        {error || localError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {localError ?? error}
          </div>
        ) : null}

        {loveVoteInfo ? (
          <div className="rounded-2xl border border-[#FFB3C1]/70 bg-[#FFE4EA]/70 p-4 text-sm text-[#C73555]">
            <div className="flex flex-wrap gap-3">
              <span>真爱票倍率：x{loveVoteInfo.weight}</span>
              <span>你的真爱票额度：{loveVoteInfo.quota} 张</span>
              <span>剩余真爱票：{availableLoveVotes} 张</span>
            </div>
          </div>
        ) : null}

        {candidates.length === 0 ? (
          <MascotEmptyState
            kind="emptyCandidates"
            title="当前活动暂无候选项"
            compact
            imageClassName="h-20 w-20 sm:h-24 sm:w-24"
          >
            暂时不能投票，请返回活动详情稍后再试。
          </MascotEmptyState>
        ) : null}

        {contest.vote_type === "single" ? (
          <RadioGroup
            name="candidateId"
            value={candidateId}
            onValueChange={(value) => {
              setCandidateId(value);
              setLoveCandidateIds((current) =>
                current.filter((id) => id === value),
              );
            }}
            className="gap-3"
          >
            {candidates.map((candidate) => (
              <Label
                key={candidate.id}
                className={cn(
                  "butter-option block cursor-pointer rounded-2xl border p-4",
                  candidateId === candidate.id &&
                    "butter-option-selected scale-[1.01]",
                )}
              >
                <div className="flex items-start gap-3">
                  <RadioGroupItem value={candidate.id} className="mt-5" />
                  <CandidateThumb candidate={candidate} show={showImage} />
                  <CandidateText
                    candidate={candidate}
                    showDescription={showDescription}
                    showNominatorInfo={showNominatorInfo}
                  />
                  <RealtimeScoreBlock score={realtimeScores?.[candidate.id]} />
                </div>
                {renderLoveCheckbox(candidate.id)}
                <RealtimeScoreNote score={realtimeScores?.[candidate.id]} />
              </Label>
            ))}
          </RadioGroup>
        ) : null}

        {contest.vote_type === "multiple" ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {contest.require_exact_choices === true
                ? `必须选择 ${contest.max_choices} 项。`
                : `最多选择 ${contest.max_choices} 项。`}
            </p>
            {candidates.map((candidate) => {
              const checked = selectedIds.includes(candidate.id);
              const disabled =
                !checked && selectedIds.length >= contest.max_choices;

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
                      name="candidateIds"
                      value={candidate.id}
                      checked={checked}
                      disabled={disabled || isSubmitting}
                      onCheckedChange={(value) =>
                        toggleCandidate(candidate.id, value === true)
                      }
                      className="mt-5"
                    />
                    <CandidateThumb candidate={candidate} show={showImage} />
                    <CandidateText
                      candidate={candidate}
                      showDescription={showDescription}
                      showNominatorInfo={showNominatorInfo}
                    />
                    <RealtimeScoreBlock score={realtimeScores?.[candidate.id]} />
                  </div>
                  {renderLoveCheckbox(candidate.id)}
                  <RealtimeScoreNote score={realtimeScores?.[candidate.id]} />
                </Label>
              );
            })}
          </div>
        ) : null}

        {contest.vote_type === "ranked" ? (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              {candidates.map((candidate) => (
                <div
                  key={candidate.id}
                  className={cn(
                    "butter-option rounded-2xl border p-3",
                    selectedRanking.includes(candidate.id) &&
                      "butter-option-selected scale-[1.01]",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <CandidateThumb candidate={candidate} show={showImage} />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{candidate.name}</div>
                      {showDescription ? (
                        <div className="line-clamp-2 text-sm leading-5 text-muted-foreground">
                          {candidate.description || "暂无简介。"}
                        </div>
                      ) : null}
                      {showNominatorInfo && candidate.nominator_display_name ? (
                        <div className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
                          <div>提名者：{candidate.nominator_display_name}</div>
                        </div>
                      ) : null}
                    </div>
                    <RealtimeScoreBlock score={realtimeScores?.[candidate.id]} />
                  </div>
                  {renderLoveCheckbox(candidate.id)}
                  <RealtimeScoreNote score={realtimeScores?.[candidate.id]} />
                </div>
              ))}
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {[0, 1, 2].map((rankIndex) => (
                <div key={rankIndex} className="space-y-2">
                  <Label>第 {rankIndex + 1} 名</Label>
                  <Select
                    name={`rank${rankIndex + 1}`}
                    value={ranking[rankIndex]}
                    onValueChange={(value) =>
                      setRanking((current) => {
                        const next = current.map((item, index) =>
                          index === rankIndex ? value : item,
                        );
                        const selected = new Set(next.filter(Boolean));
                        setLoveCandidateIds((loveIds) =>
                          loveIds.filter((id) => selected.has(id)),
                        );
                        return next;
                      })
                    }
                    disabled={isSubmitting}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择候选项" />
                    </SelectTrigger>
                    <SelectContent>
                      {candidates.map((candidate) => (
                        <SelectItem
                          key={candidate.id}
                          value={candidate.id}
                          disabled={
                            selectedRanking.includes(candidate.id) &&
                            ranking[rankIndex] !== candidate.id
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
        ) : null}

        <LoadingButton
          type="submit"
          disabled={candidates.length === 0}
          loading={isSubmitting}
          loadingText="投票提交中..."
        >
          <Send className="size-4" />
          提交投票
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
          const multipleChoiceError = getMultipleChoiceError();
          if (multipleChoiceError) {
            setConfirmOpen(false);
            setLocalError(multipleChoiceError);
            toast.error(multipleChoiceError);
            return;
          }

          setConfirmOpen(false);
          void submitCurrentVote();
        }}
      />
    </form>
  );
}
