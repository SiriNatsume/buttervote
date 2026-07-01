"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Heart, ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { supplementLoveVotesAction } from "@/lib/actions/vote-actions";
import { toUserFacingError } from "@/lib/action-error";
import { getPublicImageUrl } from "@/lib/image/image-url";
import { cn } from "@/lib/utils";
import { LoveVoteConfirmDialog } from "@/components/love-vote-confirm-dialog";
import { LoadingButton } from "@/components/loading-button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

export type LoveVoteSupplementCandidate = {
  id: string;
  name: string;
  description: string | null;
  image_path: string | null;
  nominator_display_name: string | null;
};

export type LoveVoteSupplementContest = {
  id: string;
  title: string;
  show_candidate_image: boolean;
  show_candidate_description: boolean;
  show_nominator_info: boolean;
  candidates: LoveVoteSupplementCandidate[];
  alreadyLoveCandidateIds: string[];
};

type SelectedByContest = Record<string, string[]>;

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function CandidateThumb({
  candidate,
  show,
}: {
  candidate: LoveVoteSupplementCandidate;
  show: boolean;
}) {
  const imageUrl = getPublicImageUrl(candidate.image_path);

  if (!show) {
    return null;
  }

  return (
    <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted">
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

export function LoveVoteSupplementPanel({
  groupId,
  quota,
  weight,
  used,
  contests,
  reservedLoveVotes = 0,
  className,
}: {
  groupId: string;
  quota: number;
  weight: number;
  used: number;
  contests: LoveVoteSupplementContest[];
  reservedLoveVotes?: number;
  className?: string;
}) {
  const router = useRouter();
  const [selectedByContest, setSelectedByContest] = useState<SelectedByContest>(
    {},
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const supplementableContests = useMemo(
    () =>
      contests
        .map((contest) => {
          const usedLoveSet = new Set(contest.alreadyLoveCandidateIds);
          return {
            ...contest,
            candidates: contest.candidates.filter(
              (candidate) => !usedLoveSet.has(candidate.id),
            ),
          };
        })
        .filter((contest) => contest.candidates.length > 0),
    [contests],
  );
  const remaining = Math.max(0, quota - used - reservedLoveVotes);
  const selectedCount = Object.values(selectedByContest).reduce(
    (total, candidateIds) => total + candidateIds.length,
    0,
  );
  const available = Math.max(0, remaining - selectedCount);
  const candidateNameById = useMemo(() => {
    const entries = supplementableContests.flatMap((contest) =>
      contest.candidates.map((candidate) => [candidate.id, candidate.name] as const),
    );
    return new Map(entries);
  }, [supplementableContests]);
  const selectedCandidateNames = Object.values(selectedByContest)
    .flatMap((candidateIds) => candidateIds)
    .map((candidateId) => candidateNameById.get(candidateId) ?? "未知选项");

  function toggleCandidate(contestId: string, candidateId: string, checked: boolean) {
    setSelectedByContest((current) => {
      const currentIds = current[contestId] ?? [];
      if (checked) {
        if (currentIds.includes(candidateId)) {
          return current;
        }

        const currentSelectedCount = Object.values(current).reduce(
          (total, candidateIds) => total + candidateIds.length,
          0,
        );
        if (currentSelectedCount >= remaining) {
          toast.error("剩余真爱票不足");
          return current;
        }

        return {
          ...current,
          [contestId]: [...currentIds, candidateId],
        };
      }

      const nextIds = currentIds.filter((id) => id !== candidateId);
      return {
        ...current,
        [contestId]: nextIds,
      };
    });
  }

  function submitSupplement() {
    const items = Object.entries(selectedByContest)
      .map(([contestId, candidateIds]) => ({
        contestId,
        candidateIds: uniqueStrings(candidateIds),
      }))
      .filter((item) => item.candidateIds.length > 0);

    if (items.length === 0) {
      toast.error("请选择要补投真爱票的候选项。");
      return;
    }

    startTransition(async () => {
      try {
        const result = await supplementLoveVotesAction({ groupId, items });

        if (!result.ok) {
          toast.error(toUserFacingError(result.error));
          return;
        }

        toast.success(result.message ?? "真爱票已补投");
        setSelectedByContest({});
        setConfirmOpen(false);
        router.refresh();
      } catch (error) {
        toast.error(
          toUserFacingError(
            error instanceof Error ? error.message : "真爱票补投失败，请稍后重试。",
          ),
        );
      }
    });
  }

  if (remaining <= 0 || supplementableContests.length === 0) {
    return null;
  }

  return (
    <div className={cn("butter-panel space-y-5 p-5", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-[#FFB3C1] bg-[#FFE4EA] px-3 py-1 text-sm font-medium text-[#C73555]">
            <Heart className="size-4 fill-current" />
            真爱票补投
          </div>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            可补投给你已经选择过、但还未使用真爱票的候选项。
          </p>
        </div>
        <div className="rounded-2xl border border-[#FFB3C1]/70 bg-[#FFE4EA]/60 px-4 py-3 text-sm text-[#C73555]">
          <div className="font-semibold">还可补投 {available} 张</div>
          <div className="mt-1 text-xs">
            权重 x{weight} · 总额度 {quota} · 已用 {used}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {supplementableContests.map((contest) => (
          <section key={contest.id} className="space-y-3">
            <h3 className="break-words font-semibold">{contest.title}</h3>
            <div className="grid gap-3 md:grid-cols-2">
              {contest.candidates.map((candidate) => {
                const selectedIds = selectedByContest[contest.id] ?? [];
                const checked = selectedIds.includes(candidate.id);

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
                        disabled={pending || (!checked && available <= 0)}
                        onCheckedChange={(value) =>
                          toggleCandidate(contest.id, candidate.id, value === true)
                        }
                        className="mt-4"
                      />
                      <CandidateThumb
                        candidate={candidate}
                        show={contest.show_candidate_image}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="break-words font-medium">{candidate.name}</div>
                        {contest.show_candidate_description ? (
                          <div className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">
                            {candidate.description || "暂无简介。"}
                          </div>
                        ) : null}
                        {contest.show_nominator_info &&
                        candidate.nominator_display_name ? (
                          <div className="mt-2 text-xs leading-5 text-muted-foreground">
                            提名者：{candidate.nominator_display_name}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </Label>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <LoadingButton
        type="button"
        loading={pending}
        loadingText="补投中..."
        disabled={selectedCount === 0}
        onClick={() => setConfirmOpen(true)}
      >
        <Heart className="size-4" />
        补投真爱票
      </LoadingButton>

      <LoveVoteConfirmDialog
        open={confirmOpen}
        candidateNames={selectedCandidateNames}
        loading={pending}
        onOpenChange={(open) => {
          if (!pending) {
            setConfirmOpen(open);
          }
        }}
        onConfirm={submitSupplement}
      />
    </div>
  );
}