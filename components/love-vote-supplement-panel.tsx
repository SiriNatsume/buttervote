"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Heart } from "lucide-react";
import { toast } from "sonner";
import { LoveVoteConfirmDialog } from "@/components/love-vote-confirm-dialog";
import { Button } from "@/components/ui/button";
import { VoteCandidateThumb } from "@/components/vote-candidate-thumb";
import { supplementLoveVotesAction } from "@/lib/actions/vote-actions";
import { toUserFacingError } from "@/lib/action-error";
import type { Candidate } from "@/lib/types";
import { cn } from "@/lib/utils";
import { LOVE_VOTE_SUPPLEMENT_ID } from "@/lib/vote-entry";

type SupplementCandidate = Pick<Candidate, "id" | "name" | "image_path">;

type SupplementContest = {
  id: string;
  title: string;
  show_candidate_image: boolean;
  candidates: SupplementCandidate[];
  alreadyLoveCandidateIds: string[];
};

type SupplementOptions = {
  groupId: string;
  quota: number;
  used: number;
  contests: SupplementContest[];
  reservedLoveVotes?: number;
};

export function useLoveVoteSupplement({
  groupId,
  quota,
  used,
  contests,
  reservedLoveVotes = 0,
}: SupplementOptions) {
  const router = useRouter();
  const [draftIds, setDraftIds] = useState<string[]>([]);
  const [receipt, setReceipt] = useState<{ minimumUsed: number; candidateIds: string[] }>({
    minimumUsed: 0,
    candidateIds: [],
  });
  const [pending, startTransition] = useTransition();
  const appliedIds = useMemo(() => new Set(receipt.candidateIds), [receipt.candidateIds]);
  // Keep a successful supplement accounted for while the refreshed route data arrives.
  const effectiveUsed = Math.max(used, receipt.minimumUsed);
  const remaining = Math.max(0, quota - effectiveUsed - reservedLoveVotes);

  const eligibleContests = useMemo(() => contests
    .map((contest) => {
      const alreadyUsed = new Set(contest.alreadyLoveCandidateIds);
      return {
        ...contest,
        candidates: contest.candidates.filter((candidate) =>
          !alreadyUsed.has(candidate.id) && !appliedIds.has(candidate.id),
        ),
      };
    })
    .filter((contest) => contest.candidates.length > 0), [contests, appliedIds]);

  const eligibleIds = useMemo(() => new Set(eligibleContests.flatMap((contest) =>
    contest.candidates.map((candidate) => candidate.id),
  )), [eligibleContests]);
  const selectedIds = new Set(draftIds.filter((id) => eligibleIds.has(id)));
  const available = Math.max(0, remaining - selectedIds.size);

  function toggleCandidate(candidateId: string) {
    if (pending || !eligibleIds.has(candidateId)) return;
    setDraftIds((current) => {
      const validIds = current.filter((id) => eligibleIds.has(id));
      if (validIds.includes(candidateId)) return validIds.filter((id) => id !== candidateId);
      return validIds.length < remaining ? [...validIds, candidateId] : validIds;
    });
  }

  function submit(candidateIds: string[], onSuccess: () => void) {
    if (pending || !candidateIds.length || candidateIds.length > remaining ||
      candidateIds.some((id) => !eligibleIds.has(id))) return;

    const requestedIds = new Set(candidateIds);
    const items = eligibleContests.flatMap((contest) => {
      const ids = contest.candidates.filter((candidate) => requestedIds.has(candidate.id)).map((candidate) => candidate.id);
      return ids.length ? [{ contestId: contest.id, candidateIds: ids }] : [];
    });

    startTransition(async () => {
      try {
        const result = await supplementLoveVotesAction({ groupId, items });

        if (!result.ok) {
          toast.error(toUserFacingError(result.error));
          return;
        }

        setReceipt((current) => ({
          minimumUsed: Math.max(current.minimumUsed, effectiveUsed + requestedIds.size),
          candidateIds: [...current.candidateIds, ...requestedIds],
        }));
        setDraftIds([]);
        onSuccess();
        toast.success(result.message ?? "真爱票已补投");
        router.refresh();
      } catch (error) {
        toast.error(toUserFacingError(error instanceof Error ? error.message : "真爱票补投失败，请稍后重试。"));
      }
    });
  }

  return { eligibleContests, selectedIds, appliedIds, remaining, available, effectiveUsed, pending, toggleCandidate, submit };
}

const CANDIDATE_ROW = "flex min-h-12 min-w-0 items-center gap-3 rounded-xl border px-2 py-1.5";

export function LoveVoteSupplementPanel({
  supplement,
  showBalance = false,
  disabled = false,
  className,
}: {
  supplement: ReturnType<typeof useLoveVoteSupplement>;
  showBalance?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const headingId = useId();
  const [reviewedIds, setReviewedIds] = useState<string[] | null>(null);
  const { eligibleContests, selectedIds, remaining, available, pending, toggleCandidate, submit } = supplement;
  const soleCandidate = eligibleContests.length === 1 && eligibleContests[0].candidates.length === 1
    ? eligibleContests[0].candidates[0]
    : null;
  const reviewedIdSet = new Set(reviewedIds);
  const reviewChoices = eligibleContests.flatMap((contest) =>
    contest.candidates.filter((candidate) => reviewedIdSet.has(candidate.id)).map((candidate) => ({
      id: candidate.id,
      contestTitle: contest.title,
      name: candidate.name,
    })),
  );
  const confirmDisabled = reviewedIds !== null && (reviewChoices.length !== reviewedIds.length || reviewChoices.length > remaining);

  if (!eligibleContests.length && !reviewedIds) return null;

  return (
    <section
      id={LOVE_VOTE_SUPPLEMENT_ID}
      aria-labelledby={headingId}
      className={cn("butter-panel scroll-mt-[calc(var(--site-header-height)+9rem)] space-y-4 p-3 sm:p-5", className)}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={headingId} className="text-base font-semibold">补投真爱票</h2>
        {showBalance ? <p className="text-sm text-muted-foreground" role="status">还可使用 <strong className="tabular-nums">{available}</strong> 张</p> : null}
      </div>

      {eligibleContests.map((contest) => (
        <fieldset key={contest.id} className="min-w-0 space-y-1.5">
          <legend className="mb-1.5 break-words text-xs font-medium text-muted-foreground">{contest.title}</legend>
          {contest.candidates.map((candidate) => {
            const identity = (
              <>
                <VoteCandidateThumb candidate={candidate} show={contest.show_candidate_image} compact className="size-9 rounded-lg" />
                <span className="min-w-0 flex-1 break-words text-sm font-medium">{candidate.name}</span>
              </>
            );
            if (soleCandidate) {
              return <div key={candidate.id} className={cn("border-[#EED8AA]/70 bg-white/60", CANDIDATE_ROW)}>{identity}</div>;
            }

            const checked = selectedIds.has(candidate.id);
            const choiceDisabled = disabled || pending || (!checked && available === 0);

            return (
              <label key={candidate.id} className={cn("block", choiceDisabled ? "cursor-not-allowed" : "cursor-pointer")}>
                <input
                  type="checkbox"
                  className="peer sr-only"
                  aria-label={`为${candidate.name}补投真爱票`}
                  checked={checked}
                  disabled={choiceDisabled}
                  onChange={() => toggleCandidate(candidate.id)}
                />
                <span className={cn(
                  CANDIDATE_ROW,
                  "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2",
                  checked ? "border-[#DA8FA3] bg-[#FFF0F3]" : "border-[#EED8AA]/70 bg-white/60",
                  choiceDisabled && "opacity-60",
                )}>
                  {identity}
                  <span className={cn(
                    "grid size-6 shrink-0 place-items-center rounded-md border",
                    checked ? "border-[#A7304D] bg-[#A7304D] text-white" : "text-muted-foreground",
                  )}>
                    <Heart aria-hidden="true" className={cn("size-3.5", checked && "fill-current")} />
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>
      ))}

      <div className="flex flex-wrap items-center justify-end gap-3">
        {!soleCandidate ? (
          <p role="status" className="mr-auto text-sm text-muted-foreground">已选 <strong className="tabular-nums">{selectedIds.size}</strong> 张</p>
        ) : null}
        <Button
          type="button"
          variant="loveParticipation"
          className="min-h-11"
          aria-label={soleCandidate ? `给${soleCandidate.name}补投 1 张` : undefined}
          disabled={disabled || pending || (soleCandidate ? remaining === 0 : selectedIds.size === 0 || selectedIds.size > remaining)}
          onClick={() => setReviewedIds(soleCandidate ? [soleCandidate.id] : [...selectedIds])}
        >
          {soleCandidate ? "补投 1 张" : "核对真爱票"}
        </Button>
      </div>

      <LoveVoteConfirmDialog
        open={reviewedIds !== null}
        supplementChoices={reviewChoices}
        confirmDisabled={confirmDisabled}
        loading={pending}
        onOpenChange={(open) => { if (!open && !pending) setReviewedIds(null); }}
        onConfirm={() => {
          if (reviewedIds) submit(reviewedIds, () => setReviewedIds(null));
        }}
      />
    </section>
  );
}

export function StandaloneLoveVoteSupplementPanel({ className, ...options }: SupplementOptions & { className?: string }) {
  const supplement = useLoveVoteSupplement(options);
  return <LoveVoteSupplementPanel supplement={supplement} showBalance className={className} />;
}
