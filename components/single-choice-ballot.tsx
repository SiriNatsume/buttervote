import { useId, useRef, useState } from "react";
import { Check, ChevronDown, Heart, Search, UsersRound } from "lucide-react";
import { BOTH_SUPPORT_CHOICE, BOTH_SUPPORT_LABEL } from "@/lib/both-support";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BallotCandidateRow, type BallotDisplay } from "@/components/ballot-candidate-row";
import type { CandidateCardCandidate } from "@/components/candidate-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VoteCandidateThumb } from "@/components/vote-candidate-thumb";
import { normalizeCandidateName } from "@/lib/result-search";
import { cn } from "@/lib/utils";

type SingleChoiceOptions = {
  contest: BallotDisplay;
  candidates: CandidateCardCandidate[];
  selectedId: string;
  onChange: (candidateId: string) => void;
  name: string;
  scores?: Record<string, number>;
  disabled: boolean;
  bothSupport?: { selected: boolean; onRequest: () => void; inputId: string };
};

type SingleChoiceBallotProps = Omit<SingleChoiceOptions, "name" | "bothSupport"> & {
  name?: string;
  bothSupportEnabled?: boolean;
  love?: { checked: boolean; canApply: boolean; onToggle: (candidateId: string, checked: boolean) => void };
};

const MIN_SEARCHABLE_CANDIDATES = 10;

function DuelChoices({ contest, candidates, selectedId, onChange, name, scores, disabled, bothSupport }: SingleChoiceOptions) {
  return (
    <div role="radiogroup" aria-label={`${contest.title}候选项`} className="grid grid-cols-2 gap-2.5">
      {candidates.map((candidate) => {
        const checked = candidate.id === selectedId || bothSupport?.selected;
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
                name={name}
                value={candidate.id}
                aria-label={bothSupport?.selected ? `${candidate.name}（已同时支持，点击改为仅支持此项）` : candidate.name}
                checked={candidate.id === selectedId}
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
      {bothSupport ? (
        <label className={cn("butter-option relative col-span-2 flex cursor-pointer items-center gap-3 rounded-xl border p-3", bothSupport.selected && "butter-option-selected")}>
          <input type="radio" name={name} value={BOTH_SUPPORT_CHOICE}
            id={bothSupport.inputId}
            className="peer sr-only" checked={bothSupport.selected} disabled={disabled}
            aria-label={BOTH_SUPPORT_LABEL}
            onClick={bothSupport.onRequest} onChange={bothSupport.onRequest} />
          <span className="pointer-events-none absolute inset-0 rounded-xl peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2" />
          <UsersRound className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{BOTH_SUPPORT_LABEL}</span>
            <span className="mt-1 block text-xs text-muted-foreground">双方各得 1 分，不可使用真爱票</span>
          </span>
          <span aria-hidden="true" className={cn("grid size-6 shrink-0 place-items-center rounded-full border border-[#DFC28E]", bothSupport.selected && "border-[#A65327] bg-[#A65327] text-white")}>
            {bothSupport.selected ? <Check className="size-4" /> : null}
          </span>
        </label>
      ) : null}
    </div>
  );
}

function SingleChoiceList({ contest, candidates, selectedId, onChange, name, scores, disabled, hasLove }: SingleChoiceOptions & {
  hasLove: boolean;
}) {
  const [query, setQuery] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const listId = useId();
  const searchable = candidates.length >= MIN_SEARCHABLE_CANDIDATES;
  const term = searchable ? normalizeCandidateName(query) : "";
  const matches = term
    ? candidates.filter((candidate) => normalizeCandidateName(candidate.name).includes(term))
    : candidates;

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
        <span className="font-medium">请选择 1 项</span>
        <span role="status" className="text-xs tabular-nums text-muted-foreground">
          {term ? `匹配 ${matches.length} / ${candidates.length} 项` : `名单共 ${candidates.length} 项`}
        </span>
      </div>
      {searchable ? (
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchInput}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
                event.preventDefault();
              }
            }}
            aria-label="按名字搜索候选项"
            aria-controls={listId}
            placeholder="按名字搜索候选项"
            enterKeyHint="search"
            autoComplete="off"
            disabled={disabled}
            className="h-11 pl-9 pr-14 [&::-webkit-search-cancel-button]:appearance-none"
          />
          {query ? (
            <button
              type="button"
              aria-label="清空搜索"
              disabled={disabled}
              className="absolute inset-y-0 right-1 min-w-11 rounded-lg text-sm text-[#834322] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => {
                setQuery("");
                searchInput.current?.focus();
              }}
            >
              清空
            </button>
          ) : null}
        </div>
      ) : null}
      <div id={listId} role="radiogroup" aria-label={`${contest.title}候选项`}>
        <ul className="space-y-1.5">
          {matches.map((candidate) => (
            <BallotCandidateRow
              key={candidate.id}
              contest={contest}
              candidate={candidate}
              selected={candidate.id === selectedId}
              hasLove={hasLove && candidate.id === selectedId}
              score={scores?.[candidate.id]}
              disabled={disabled}
              choice={{ kind: "single", name, onSelect: () => onChange(candidate.id) }}
            />
          ))}
        </ul>
        {matches.length === 0 ? (
          <p className="rounded-xl border border-dashed px-3 py-5 text-center text-sm text-muted-foreground">
            没有找到匹配的候选项，试试名字中的一两个字。
          </p>
        ) : null}
      </div>
      {/* Keep the native form value when the checked radio is filtered out. */}
      {term && selectedId && !matches.some((candidate) => candidate.id === selectedId) ? (
        <input type="hidden" name={name} value={selectedId} />
      ) : null}
    </>
  );
}

export function SingleChoiceBallot({ contest, candidates, selectedId, onChange, name, love, scores, disabled, bothSupportEnabled = false }: SingleChoiceBallotProps) {
  const choiceName = useId();
  const [bothConfirmOpen, setBothConfirmOpen] = useState(false);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const bothChoiceId = `${choiceName}-both-support`;
  const supportsBoth = selectedId === BOTH_SUPPORT_CHOICE || bothConfirmOpen;
  const selected = candidates.find((candidate) => candidate.id === selectedId);
  const hasScores = candidates.some((candidate) => typeof scores?.[candidate.id] === "number");
  const isDuel = candidates.length === 2;
  const options = { contest, candidates, selectedId: supportsBoth ? "" : selected?.id ?? "", onChange, name: name ?? choiceName, scores, disabled,
    bothSupport: bothSupportEnabled && isDuel ? { selected: supportsBoth, inputId: bothChoiceId, onRequest: () => {
      if (disabled) return;
      onChange("");
      setBothConfirmOpen(true);
    } } : undefined,
  };

  return (
    <div className={isDuel ? "mx-auto max-w-md space-y-3" : "space-y-2.5"}>
      {isDuel ? <DuelChoices {...options} /> : <SingleChoiceList {...options} hasLove={Boolean(love?.checked)} />}
      {hasScores ? <p className="text-xs text-muted-foreground">实时总分不含真爱票</p> : null}
      <div className={cn(
        "flex min-h-12 items-center gap-2 rounded-xl border border-[#E5CDA3] bg-[#FFF8E9] px-2.5 py-1.5",
        !isDuel && "sticky bottom-[calc(var(--site-bottom-nav-height)+env(safe-area-inset-bottom,0px)+0.5rem)] z-10 shadow-sm max-lg:mr-9 lg:bottom-3",
      )}>
        <div role="status" className="flex min-w-0 flex-1 items-center gap-2 text-sm">
          {supportsBoth ? <span className="font-semibold">已选：{BOTH_SUPPORT_LABEL}</span> : selected ? (
            <>
              <VoteCandidateThumb candidate={selected} show={contest.show_candidate_image} compact className="size-8 rounded-full" />
              <span className={cn("min-w-0 break-words font-semibold", !isDuel && "line-clamp-2")}>已选 {selected.name}</span>
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
            disabled={disabled || supportsBoth || !selected || (!love.checked && !love.canApply)}
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
      {supportsBoth ? <p className="text-xs leading-5 text-muted-foreground">不会更新最终得票时间，这张选票不能补投真爱票。</p> : null}
      <Dialog open={bothConfirmOpen} onOpenChange={(open) => {
        setBothConfirmOpen(open);
        if (!open) onChange("");
      }}>
        <DialogContent className="max-w-md" onOpenAutoFocus={(event) => {
          event.preventDefault(); cancelButton.current?.focus();
        }} onCloseAutoFocus={(event) => {
          event.preventDefault(); document.getElementById(bothChoiceId)?.focus();
        }}>
          <DialogHeader>
            <DialogTitle>确认{BOTH_SUPPORT_LABEL}</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-4 pt-2 text-left text-sm leading-7 text-foreground">
                <p>这将使<strong>两个选项都得到一票</strong>，但是<strong>不会更新任何选项的最终得票时间</strong>。同时，你将<strong>不能对这两个选项使用真爱票</strong>。</p>
                <p>「我们建议仅在不认识本组候选项时做出此决定。」</p>
                <p>即使如此你也要继续吗？</p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap justify-end gap-3">
            <Button ref={cancelButton} type="button" variant="outline" onClick={() => {
              onChange(""); setBothConfirmOpen(false);
            }}>我再想想</Button>
            <Button type="button" onClick={() => {
              onChange(BOTH_SUPPORT_CHOICE); setBothConfirmOpen(false);
            }}>我已知悉</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
