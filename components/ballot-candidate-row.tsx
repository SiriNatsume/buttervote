import { useId, useState } from "react";
import { ArrowLeftRight, Check, ChevronDown, Heart, Plus } from "lucide-react";
import type { CandidateCardCandidate } from "@/components/candidate-card";
import { VoteCandidateThumb } from "@/components/vote-candidate-thumb";
import type { Contest } from "@/lib/types";
import { cn } from "@/lib/utils";

export type BallotDisplay = Pick<
  Contest,
  "title" | "show_candidate_image" | "show_candidate_description" | "show_nominator_info"
>;

type RowChoice =
  | { kind: "single"; name: string; onSelect: () => void }
  | { kind: "multiple"; full: boolean; onChoose: (button: HTMLButtonElement) => void };

export function BallotCandidateRow({ candidate, contest, selected, hasLove, score, disabled, choice }: {
  candidate: CandidateCardCandidate;
  contest: BallotDisplay;
  selected: boolean;
  hasLove: boolean;
  score?: number;
  disabled: boolean;
  choice: RowChoice;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailId = useId();
  const description = contest.show_candidate_description && candidate.description;
  const nominator = contest.show_nominator_info && candidate.nominator_display_name;
  const content = (
    <>
      <VoteCandidateThumb candidate={candidate} show={contest.show_candidate_image} compact />
      <span className="min-w-0 flex-1">
        <span className="break-words font-medium leading-snug">{candidate.name}</span>
        {hasLove ? <Heart className="ml-1 inline size-3.5 fill-current text-[#C73555]" aria-label="已用真爱票" /> : null}
        {description && !expanded ? <span className="block truncate text-xs leading-5 text-muted-foreground">{description}</span> : null}
        {!description && nominator ? <span className="block break-words text-xs text-muted-foreground">提名者：{nominator}</span> : null}
        {typeof score === "number" ? <span className="block text-xs tabular-nums text-muted-foreground">实时 {score} 分</span> : null}
      </span>
    </>
  );
  const controlClass = "flex min-h-12 min-w-0 flex-1 items-center gap-2.5 rounded-xl p-2 text-left";

  function renderControl() {
    if (choice.kind === "single") {
      return (
        <label className={cn(controlClass, "cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring")}>
          {content}
          <input
            type="radio"
            name={choice.name}
            value={candidate.id}
            aria-label={candidate.name}
            checked={selected}
            disabled={disabled}
            onChange={choice.onSelect}
            className="size-4 shrink-0 accent-[#A65327] focus-visible:outline-none"
          />
        </label>
      );
    }

    const verb = selected ? "取消选择" : choice.full ? "换入" : "选择";
    const Mark = selected ? Check : choice.full ? ArrowLeftRight : Plus;
    return (
      <button
        type="button"
        aria-label={`${verb}${candidate.name}`}
        aria-pressed={selected}
        aria-haspopup={choice.full && !selected ? "dialog" : undefined}
        disabled={disabled}
        onClick={(event) => choice.onChoose(event.currentTarget)}
        className={cn(controlClass, "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
      >
        {content}
        <Mark aria-hidden="true" className={cn("size-4 shrink-0", selected ? "text-orange-700" : "text-muted-foreground")} />
      </button>
    );
  }

  return (
    <li className={cn("butter-option rounded-xl border", selected && "butter-option-selected")}>
      <div className="flex items-center">
        {renderControl()}
        {description ? (
          <button
            type="button"
            aria-label={`${expanded ? "收起" : "展开"}${candidate.name}的简介`}
            aria-expanded={expanded}
            aria-controls={detailId}
            disabled={disabled}
            className="flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setExpanded(!expanded)}
          >
            <ChevronDown aria-hidden="true" className={cn("size-4", expanded && "rotate-180")} />
          </button>
        ) : null}
      </div>
      {description ? (
        <div id={detailId} hidden={!expanded} className="border-t px-3 py-2.5 text-sm leading-6 text-muted-foreground">
          <p className="whitespace-pre-line break-words">{description}</p>
          {nominator ? <p className="mt-1 text-xs">提名者：{nominator}</p> : null}
        </div>
      ) : null}
    </li>
  );
}
