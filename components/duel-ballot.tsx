import { useId } from "react";
import { Check, ChevronDown, Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VoteCandidateThumb } from "@/components/vote-candidate-thumb";
import type { Candidate, Contest } from "@/lib/types";
import { cn } from "@/lib/utils";

type DuelContest = Pick<
  Contest,
  "title" | "show_candidate_image" | "show_candidate_description" | "show_nominator_info"
>;
type DuelCandidate = Pick<Candidate, "id" | "name" | "description" | "image_path" | "nominator_display_name">;

export function DuelBallot({
  contest,
  candidates,
  selectedId,
  onChange,
  name,
  love,
  scores,
  disabled,
}: {
  contest: DuelContest;
  candidates: DuelCandidate[];
  selectedId: string;
  onChange: (candidateId: string) => void;
  name?: string;
  love?: { checked: boolean; canApply: boolean; onToggle: (candidateId: string, checked: boolean) => void };
  scores?: Record<string, number>;
  disabled: boolean;
}) {
  const choiceName = useId();
  const selected = candidates.find((candidate) => candidate.id === selectedId);
  const hasScores = candidates.some((candidate) => typeof scores?.[candidate.id] === "number");

  return (
    <div className="mx-auto max-w-md space-y-3">
      <div role="radiogroup" aria-label={`${contest.title}候选项`} className="grid grid-cols-2 gap-2.5">
        {candidates.map((candidate) => {
          const checked = candidate.id === selectedId;
          const description = contest.show_candidate_description ? candidate.description : null;
          const score = scores?.[candidate.id];

          return (
            <div
              key={candidate.id}
              className={cn(
                "butter-option relative flex min-w-0 flex-col rounded-2xl border shadow-sm",
                checked && "butter-option-selected",
              )}
            >
              <label className="group relative flex min-w-0 flex-1 cursor-pointer flex-col rounded-2xl">
                <input
                  className="peer sr-only"
                  type="radio"
                  name={name ?? choiceName}
                  value={candidate.id}
                  aria-label={candidate.name}
                  checked={checked}
                  disabled={disabled}
                  onChange={() => onChange(candidate.id)}
                />
                <span className="pointer-events-none absolute inset-0 z-10 rounded-2xl peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2" />
                <VoteCandidateThumb candidate={candidate} show={contest.show_candidate_image} portrait className="rounded-t-[15px]" />
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute right-2 top-2 grid size-6 place-items-center rounded-full border border-[#DFC28E] bg-[#FFFCF4]",
                    checked && "border-[#A65327] bg-[#A65327] text-white",
                  )}
                >
                  {checked ? <Check className="size-4" /> : null}
                </span>
                <span className={cn("flex min-h-12 flex-1 flex-col justify-between gap-1 px-2.5 py-2 sm:px-3", !contest.show_candidate_image && "pr-9 pt-3 sm:pr-9")}>
                  <span className="break-words text-sm font-semibold [text-wrap:balance] sm:text-base">{candidate.name}</span>
                  {contest.show_nominator_info && candidate.nominator_display_name ? (
                    <span className="break-words text-xs text-muted-foreground">提名者：{candidate.nominator_display_name}</span>
                  ) : null}
                  {typeof score === "number" ? (
                    <span className="text-xs tabular-nums text-muted-foreground">实时 {score} 分</span>
                  ) : null}
                </span>
              </label>
              {description ? (
                <details className="group px-2.5 pb-2 sm:px-3">
                  <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-1 rounded-md text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                    <span className="truncate group-open:hidden">{description}</span>
                    <span className="hidden group-open:inline">收起简介</span>
                    <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 group-open:rotate-180" />
                  </summary>
                  <p className="whitespace-pre-line break-words pb-1 text-xs leading-5 text-muted-foreground">{description}</p>
                </details>
              ) : null}
            </div>
          );
        })}
      </div>
      {hasScores ? <p className="text-xs text-muted-foreground">实时总分不含真爱票</p> : null}
      <div className="flex min-h-12 items-center gap-2 rounded-xl border border-[#E5CDA3] bg-[#FFF8E9] px-2.5 py-1.5">
        <div role="status" className="flex min-w-0 flex-1 items-center gap-2 text-sm">
          {selected ? (
            <>
              <VoteCandidateThumb candidate={selected} show={contest.show_candidate_image} compact className="size-8 rounded-full" />
              <span className="min-w-0 break-words font-semibold">已选 {selected.name}</span>
            </>
          ) : (
            <span className="text-muted-foreground">选择你支持的选项</span>
          )}
        </div>
        {love ? (
          <Button
            type="button"
            variant="outline"
            aria-label={selected ? `为${selected.name}使用真爱票` : "真爱票"}
            aria-pressed={love.checked}
            disabled={disabled || !selected || (!love.checked && !love.canApply)}
            onClick={() => { if (selected) love.onToggle(selected.id, !love.checked); }}
            className={cn(
              "min-h-11 rounded-xl px-3 shadow-none",
              love.checked ? "border-[#DC97AA] bg-[#FFE4EA] text-[#A7304D] hover:bg-[#FFD8E1] hover:text-[#902340]" : "text-muted-foreground",
            )}
          >
            <Heart aria-hidden="true" className={cn(love.checked && "fill-current")} />
            真爱票
          </Button>
        ) : null}
      </div>
    </div>
  );
}
