import { useId, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRight, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Heart, Plus, X,
} from "lucide-react";
import { toast } from "sonner";
import type { CandidateCardCandidate } from "@/components/candidate-card";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { VoteCandidateThumb } from "@/components/vote-candidate-thumb";
import type { Contest } from "@/lib/types";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 8;

type BallotRules = Pick<
  Contest,
  "title" | "max_choices" | "require_exact_choices" | "show_candidate_image" | "show_candidate_description" | "show_nominator_info"
>;
type LoveVotes = {
  ids: string[];
  remaining: number;
  onToggle: (id: string, checked: boolean) => void;
};
type BallotDialog = { kind: "selected" } | { kind: "replace"; candidate: CandidateCardCandidate };

function CandidateRow({ candidate, contest, selected, full, hasLove, score, onChoose }: {
  candidate: CandidateCardCandidate;
  contest: BallotRules;
  selected: boolean;
  full: boolean;
  hasLove: boolean;
  score?: number;
  onChoose: (button: HTMLButtonElement) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailId = useId();
  const description = contest.show_candidate_description && candidate.description;
  const nominator = contest.show_nominator_info && candidate.nominator_display_name;
  const verb = selected ? "取消选择" : full ? "换入" : "选择";
  const Mark = selected ? Check : full ? ArrowLeftRight : Plus;

  return (
    <li className={cn("butter-option rounded-xl border", selected && "butter-option-selected")}>
      <div className="flex items-center">
        <button
          type="button"
          aria-label={`${verb}${candidate.name}`}
          aria-pressed={selected}
          aria-haspopup={full && !selected ? "dialog" : undefined}
          onClick={(event) => onChoose(event.currentTarget)}
          className="flex min-h-12 min-w-0 flex-1 items-center gap-2.5 rounded-xl p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <VoteCandidateThumb candidate={candidate} show={contest.show_candidate_image} compact />
          <span className="min-w-0 flex-1">
            <span className="break-words font-medium leading-snug">{candidate.name}</span>
            {hasLove ? <Heart className="ml-1 inline size-3.5 fill-current text-[#C73555]" aria-label="已用真爱票" /> : null}
            {description && !expanded ? <span className="block truncate text-xs leading-5 text-muted-foreground">{description}</span> : null}
            {!description && nominator ? <span className="block break-words text-xs text-muted-foreground">提名者：{nominator}</span> : null}
            {typeof score === "number" ? <span className="block text-xs tabular-nums text-muted-foreground">实时 {score} 分</span> : null}
          </span>
          <Mark
            aria-hidden="true"
            className={cn("size-4 shrink-0", selected ? "text-orange-700" : "text-muted-foreground")}
          />
        </button>
        {description ? (
          <button
            type="button"
            aria-label={`${expanded ? "收起" : "展开"}${candidate.name}的简介`}
            aria-expanded={expanded}
            aria-controls={detailId}
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

export function MultipleChoiceBallot({ contest, candidates, selectedIds, onChange, love, scores, disabled }: {
  contest: BallotRules;
  candidates: CandidateCardCandidate[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  love?: LoveVotes;
  scores?: Record<string, number>;
  disabled: boolean;
}) {
  const [page, setPage] = useState(0);
  const [dialog, setDialog] = useState<BallotDialog | null>(null);
  const heading = useRef<HTMLParagraphElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const dialogTitle = useRef<HTMLHeadingElement>(null);
  const byId = useMemo(() => new Map(candidates.map((item) => [item.id, item])), [candidates]);
  const selected = selectedIds.map((id) => byId.get(id)).filter((item) => item !== undefined);
  const pageCount = Math.ceil(candidates.length / PAGE_SIZE);
  const currentPage = Math.min(page, Math.max(0, pageCount - 1));
  const start = currentPage * PAGE_SIZE;
  const pageItems = candidates.slice(start, start + PAGE_SIZE);
  const full = selectedIds.length >= contest.max_choices;
  const rule = `${contest.require_exact_choices ? "必须" : "最多"}选 ${contest.max_choices} 项`;
  if (!candidates.length) return null;

  function browse(next: number) {
    setPage(next);
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }

  function choose(candidate: CandidateCardCandidate, button: HTMLButtonElement) {
    if (selectedIds.includes(candidate.id)) {
      onChange(selectedIds.filter((id) => id !== candidate.id));
    } else if (full) {
      trigger.current = button;
      setDialog({ kind: "replace", candidate });
    } else {
      onChange([...selectedIds, candidate.id]);
    }
  }

  function replace(outgoing: CandidateCardCandidate) {
    if (dialog?.kind !== "replace") return;
    const incoming = dialog.candidate;
    onChange(selectedIds.map((id) => id === outgoing.id ? incoming.id : id));
    setDialog(null);
    toast.success(`已用「${incoming.name}」换下「${outgoing.name}」`);
  }

  return (
    <div className="space-y-2.5">
      <p
        ref={heading}
        tabIndex={-1}
        className="flex scroll-mt-[calc(var(--site-header-height)+var(--vote-scroll-offset,1rem))] flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded text-sm focus:outline-none"
      >
        <span className="font-medium">{rule}</span>
        <span aria-live="polite" aria-atomic="true" className="text-xs tabular-nums text-muted-foreground">
          {pageCount > 1 ? `第 ${start + 1}–${start + pageItems.length} 项 · ` : ""}共 {candidates.length} 项
        </span>
      </p>
      <ul aria-label={`${contest.title}候选项`} className="space-y-1.5">
        {pageItems.map((candidate) => (
          <CandidateRow
            key={candidate.id}
            candidate={candidate}
            contest={contest}
            selected={selectedIds.includes(candidate.id)}
            full={full}
            hasLove={love?.ids.includes(candidate.id) ?? false}
            score={scores?.[candidate.id]}
            onChoose={(button) => choose(candidate, button)}
          />
        ))}
      </ul>
      {scores && pageItems.some((item) => typeof scores[item.id] === "number") ? (
        <p className="text-xs text-muted-foreground">实时总分不含真爱票</p>
      ) : null}
      <div className="sticky bottom-[calc(var(--site-bottom-nav-height)+env(safe-area-inset-bottom,0px)+0.5rem)] z-10 flex items-center justify-between gap-1 rounded-xl border border-[#E5CDA3] bg-[#FFF8E9] px-2 py-1 shadow-sm max-lg:mr-9 lg:bottom-3">
        <button
          type="button"
          disabled={disabled || !selected.length}
          aria-haspopup="dialog"
          aria-label={`查看已选，已选 ${selected.length} 项，${rule}`}
          className="min-h-11 min-w-0 rounded-lg px-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={(event) => {
            trigger.current = event.currentTarget;
            setDialog({ kind: "selected" });
          }}
        >
          <span aria-live="polite" aria-atomic="true" className="block whitespace-nowrap text-sm font-semibold tabular-nums">
            已选 {selected.length} / {contest.max_choices} 项
          </span>
          {selected.length > 0 ? (
            <span className="flex items-center gap-0.5 text-xs text-[#925331]">
              查看已选{love ? " · 真爱票" : ""}<ChevronUp aria-hidden="true" className="size-3" />
            </span>
          ) : null}
        </button>
        {pageCount > 1 ? (
          <nav aria-label={`${contest.title}候选项翻页`} className="flex shrink-0 items-center">
            <Button
              type="button" variant="ghost" size="icon" className="size-11"
              disabled={disabled || currentPage === 0}
              aria-label="上一批候选项" onClick={() => browse(currentPage - 1)}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <span className="text-xs tabular-nums text-muted-foreground">{currentPage + 1}/{pageCount}</span>
            <Button
              type="button" variant="ghost" size="icon" className="size-11"
              disabled={disabled || currentPage + 1 >= pageCount}
              aria-label="下一批候选项" onClick={() => browse(currentPage + 1)}
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </nav>
        ) : null}
      </div>
      <Dialog open={dialog !== null} onOpenChange={(open) => { if (!open) setDialog(null); }}>
        <DialogContent
          className="bottom-0 left-0 top-auto max-h-[80dvh] w-full max-w-none translate-x-0 translate-y-0 rounded-b-none pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[calc(100%-2rem)] sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            dialogTitle.current?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const button = trigger.current;
            (button?.isConnected && !button.disabled ? button : heading.current)?.focus({ preventScroll: true });
          }}
        >
          <DialogHeader className="pr-7">
            <DialogTitle ref={dialogTitle} tabIndex={-1} className="break-words leading-snug focus:outline-none">
              {dialog?.kind === "replace" ? `用「${dialog.candidate.name}」换下谁？` : "我已选的候选项"}
            </DialogTitle>
            <DialogDescription>
              {contest.title} · 已选 {selected.length} 项
              {dialog?.kind === "replace" && love?.ids.length ? "。换下已用真爱票的候选项会归还额度。" : null}
              {dialog?.kind === "selected" && love ? ` · 真爱票还可用 ${love.remaining} 张` : null}
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-2">
            {selected.map((candidate) => {
              const hasLove = love?.ids.includes(candidate.id) ?? false;
              const identity = (
                <>
                  <VoteCandidateThumb candidate={candidate} show={contest.show_candidate_image} compact />
                  <span className="min-w-0 flex-1 break-words text-left text-sm font-medium">{candidate.name}</span>
                </>
              );
              return (
                <li key={candidate.id} className="rounded-xl border bg-white/50">
                  {dialog?.kind === "replace" ? (
                    <button
                      type="button"
                      aria-label={`换下${candidate.name}${hasLove ? "并归还真爱票" : ""}`}
                      className="flex min-h-12 w-full items-center gap-2 rounded-xl p-2 text-sm hover:bg-[#FFF3D0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      disabled={disabled}
                      onClick={() => replace(candidate)}
                    >
                      {identity}
                      {hasLove ? <Heart aria-label="已用真爱票" className="size-4 shrink-0 fill-current text-[#C73555]" /> : null}
                      <span className="shrink-0 px-1 text-[#925331]">换下</span>
                    </button>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2 p-2">
                      {identity}
                      {love ? (
                        <Button
                          type="button" size="sm" variant="outline"
                          className={cn("min-h-11 gap-1.5 px-2", hasLove && "butter-love")}
                          aria-label={`为${candidate.name}使用真爱票`}
                          aria-pressed={hasLove}
                          disabled={disabled || (!hasLove && love.remaining <= 0)}
                          onClick={() => love.onToggle(candidate.id, !hasLove)}
                        >
                          <Heart aria-hidden="true" className={cn("size-4", hasLove && "fill-current")} />真爱票
                        </Button>
                      ) : null}
                      <Button
                        type="button" variant="ghost" size="icon" className="size-11"
                        aria-label={`移出${candidate.name}`}
                        disabled={disabled}
                        onClick={() => {
                          onChange(selectedIds.filter((id) => id !== candidate.id));
                          if (selected.length === 1) setDialog(null);
                          else dialogTitle.current?.focus({ preventScroll: true });
                        }}
                      >
                        <X aria-hidden="true" />
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <DialogClose asChild>
            <Button type="button" variant="outline" className="min-h-11">返回名单</Button>
          </DialogClose>
        </DialogContent>
      </Dialog>
    </div>
  );
}
