"use client";

import Link from "next/link";
import {
  type FocusEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ExternalLink, Heart, UserRound } from "lucide-react";
import { formatDateTime } from "@/lib/time";
import type { ContestStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

type TooltipParticipant = {
  name: string;
  imageUrl: string | null;
  score: number | null;
  normalScore: number | null;
  loveScore: number | null;
  loveVoteCount: number | null;
  isWinner: boolean;
};

export type TournamentMatchTooltipData = {
  contestId: string;
  contestTitle: string;
  status: ContestStatus;
  scheduledStartsAt: string | null;
  scheduledEndsAt: string | null;
  resultVisible: boolean;
  loveVoteWeight: number | null;
  tiebreakExplanation: string | null;
  left: TooltipParticipant | null;
  right: TooltipParticipant | null;
};

type Position = {
  left: number;
  top: number;
  width: number;
  placement: "top" | "bottom";
};

const VIEWPORT_GAP = 12;
const TOOLTIP_GAP = 8;
const TOOLTIP_DEFAULT_WIDTH = 260;
const TOOLTIP_MAX_WIDTH = 440;

function supportsHoverInteraction() {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

function ParticipantAvatar({ participant }: { participant: TooltipParticipant | null }) {
  return (
    <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded bg-[#F7EAD0]">
      {participant?.imageUrl ? (
        <img
          src={participant.imageUrl}
          alt={`${participant.name} 图片`}
          className="size-full object-cover"
        />
      ) : (
        <UserRound className="size-4 text-[#B9854C]" aria-hidden="true" />
      )}
    </div>
  );
}

function ParticipantSummary({
  participant,
}: {
  participant: TooltipParticipant | null;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center">
      <ParticipantAvatar participant={participant} />
      <span
        className={cn(
          "min-w-0 break-words text-xs leading-4 text-[#3F2418]",
          participant?.isWinner ? "font-bold" : "font-medium",
        )}
      >
        {participant?.name ?? "待定"}
      </span>
    </div>
  );
}

function BreakdownValue({ value }: { value: number | null | undefined }) {
  return (
    <span className="text-center font-semibold tabular-nums text-[#4A2B1B]">
      {value ?? "—"}
    </span>
  );
}

function totalVoteCount(participant: TooltipParticipant | null) {
  if (!participant) return null;
  if (participant.normalScore === null || participant.loveVoteCount === null) {
    return null;
  }
  return participant.normalScore + participant.loveVoteCount;
}

type MatchDisplayState = "upcoming" | "voting" | "closed" | "published";

function matchDisplayState(data: TournamentMatchTooltipData): MatchDisplayState {
  if (data.status === "voting") return "voting";
  if (data.resultVisible) return "published";
  if (data.status === "closed" || data.status === "published") return "closed";
  return "upcoming";
}

function TooltipPanel({
  data,
  tooltipId,
  pinned,
}: {
  data: TournamentMatchTooltipData;
  tooltipId: string;
  pinned: boolean;
}) {
  const displayState = matchDisplayState(data);
  const showResults =
    displayState === "published" ||
    (displayState === "voting" && data.resultVisible);
  const hasBreakdown =
    displayState === "published" && data.left !== null && data.right !== null;
  const timeIsEnd = displayState === "closed" || displayState === "published";
  return (
    <div
      id={tooltipId}
      role="dialog"
      aria-label={`${data.contestTitle}比赛信息`}
      className="overflow-hidden rounded-lg border border-[#D8BF8B] bg-[#FFFCF4] shadow-[0_12px_35px_rgba(74,43,27,0.22)]"
    >
      <div className="border-b border-[#E8DCC3] px-4 py-3 text-center">
        <div className="text-[11px] font-medium text-[#8A6A45]">
          {timeIsEnd ? "结束时间" : "开始时间"}
        </div>
        <div className="mt-0.5 text-sm font-semibold text-[#4A2B1B]">
          {formatDateTime(timeIsEnd ? data.scheduledEndsAt : data.scheduledStartsAt)}
        </div>
      </div>

      <div className="px-4 py-3">
        <div
          className={cn(
            "grid items-start",
            showResults
              ? "grid-cols-[minmax(0,1fr)_92px_minmax(0,1fr)]"
              : "grid-cols-2 gap-6",
          )}
        >
          <ParticipantSummary participant={data.left} />
          {showResults ? (
            <div className="self-center text-center">
              <div className="text-[30px] font-bold leading-none tabular-nums text-[#4A2B1B]">
                {data.left?.score ?? "—"}
                <span className="mx-1.5 text-[#A58A68]">|</span>
                {data.right?.score ?? "—"}
              </div>
              {displayState === "voting" ? (
                <div className="mt-1 whitespace-nowrap text-[10px] font-normal leading-3 text-[#A58A68]">
                  （不含真爱票）
                </div>
              ) : null}
            </div>
          ) : null}
          <ParticipantSummary participant={data.right} />
        </div>
      </div>

      {displayState === "voting" ? (
        <Link
          href={`/contests/${data.contestId}/vote`}
          className="match-in-progress-breathe mx-4 mb-3 block rounded-md px-3 py-2 text-center text-xs font-medium text-[#3F7A48] transition-colors hover:text-[#2F693A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#75A97D] focus-visible:ring-offset-2"
        >
          比赛进行中
        </Link>
      ) : null}

      {displayState === "closed" ? (
        <div className="mx-4 mb-3 rounded-md bg-[#FFF8E8] px-3 py-2 text-center text-xs text-[#7A6040]">
          比赛结果尚未公开
        </div>
      ) : null}

      {hasBreakdown ? (
        <>
          <div className="mx-4 mb-3 grid grid-cols-[minmax(0,1fr)_92px_minmax(0,1fr)] items-center gap-y-1.5 rounded-md bg-[#FFF8E8] py-2 text-xs">
            <BreakdownValue value={totalVoteCount(data.left)} />
            <span className="text-center text-[#7A6040]">总票数</span>
            <BreakdownValue value={totalVoteCount(data.right)} />
            <BreakdownValue value={data.left?.loveVoteCount} />
            <span className="flex items-center justify-center whitespace-nowrap text-[#7A6040]">
              <span className="relative inline-flex items-center justify-center">
                <Heart
                  className="absolute right-full mr-1 size-3 -translate-y-1/2 fill-[#E9969F] text-[#E9969F]"
                  style={{ top: "50%" }}
                  aria-hidden="true"
                />
                真爱票
                {data.loveVoteWeight !== null ? (
                  <span className="absolute left-full top-1/2 ml-1 -translate-y-1/2 rounded-[3px] bg-[#F8D7DE] px-1 py-0.5 text-[9px] font-semibold leading-none text-[#B34A62]">
                    x{data.loveVoteWeight}
                  </span>
                ) : null}
              </span>
            </span>
            <BreakdownValue value={data.right?.loveVoteCount} />
          </div>
          {data.tiebreakExplanation ? (
            <div className="mx-4 mb-3 rounded-md bg-[#F1F1F1] px-3 py-2 text-center text-xs italic leading-5 text-[#666]">
              <div className="whitespace-pre-line">{data.tiebreakExplanation}</div>
            </div>
          ) : null}
        </>
      ) : null}

      <div className="flex items-center justify-between gap-3 border-t border-[#E8DCC3] px-4 py-2.5">
        <span className="text-[11px] text-[#8A6A45]">
          {pinned ? "点击外部可关闭" : "点击比赛可固定显示"}
        </span>
        <Link
          href={`/contests/${data.contestId}`}
          className="inline-flex items-center gap-1 text-xs font-semibold text-[#9A5D2E] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B9854C]"
        >
          进入比赛页面
          <ExternalLink className="size-3" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

export function TournamentMatchTooltip({
  data,
  children,
}: {
  data: TournamentMatchTooltipData;
  children: ReactNode;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const tooltipId = useId();
  const open = hovered || focused || pinned;

  const cancelScheduledClose = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleHoverClose = useCallback(() => {
    cancelScheduledClose();
    closeTimerRef.current = setTimeout(() => setHovered(false), 120);
  }, [cancelScheduledClose]);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const longestNameCharacters = Math.max(
      Array.from(data.left?.name ?? "").length,
      Array.from(data.right?.name ?? "").length,
    );
    const preferredWidth = Math.min(
      TOOLTIP_MAX_WIDTH,
      Math.max(TOOLTIP_DEFAULT_WIDTH, 160 + longestNameCharacters * 16),
    );
    const width = Math.min(
      preferredWidth,
      Math.max(0, window.innerWidth - VIEWPORT_GAP * 2),
    );
    const panelHeight = panelRef.current?.offsetHeight ?? 250;
    const spaceAbove = rect.top - VIEWPORT_GAP;
    const placement = spaceAbove >= panelHeight + TOOLTIP_GAP ? "top" : "bottom";
    const top =
      placement === "top"
        ? Math.max(VIEWPORT_GAP, rect.top - panelHeight - TOOLTIP_GAP)
        : Math.max(
            VIEWPORT_GAP,
            Math.min(
              window.innerHeight - panelHeight - VIEWPORT_GAP,
              rect.bottom + TOOLTIP_GAP,
            ),
          );
    const centeredLeft = rect.left + rect.width / 2 - width / 2;
    const left = Math.min(
      window.innerWidth - width - VIEWPORT_GAP,
      Math.max(VIEWPORT_GAP, centeredLeft),
    );
    setPosition({ left, top, width, placement });
  }, [data.left?.name, data.right?.name]);

  useEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    updatePosition();
    const frame = requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!pinned) return;
    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        panelRef.current?.contains(target)
      ) {
        return;
      }
      setPinned(false);
      setHovered(false);
      setFocused(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPinned(false);
        setHovered(false);
        setFocused(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [pinned]);

  useEffect(
    () => () => {
      cancelScheduledClose();
    },
    [cancelScheduledClose],
  );

  function handleMouseEnter() {
    if (!supportsHoverInteraction()) return;
    cancelScheduledClose();
    setHovered(true);
  }

  function handleBlur(event: FocusEvent<HTMLButtonElement>) {
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && panelRef.current?.contains(nextTarget)) return;
    setFocused(false);
  }

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    setPinned((current) => !current);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="block w-full rounded-[3px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B9854C] focus-visible:ring-offset-2"
        aria-expanded={open}
        aria-controls={open ? tooltipId : undefined}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={scheduleHoverClose}
        onFocus={() => setFocused(true)}
        onBlur={handleBlur}
        onClick={handleClick}
      >
        {children}
      </button>

      {open && position
        ? createPortal(
            <div
              ref={panelRef}
              className="fixed z-[100]"
              style={{ left: position.left, top: position.top, width: position.width }}
              data-placement={position.placement}
              onMouseEnter={() => {
                if (!supportsHoverInteraction()) return;
                cancelScheduledClose();
                setHovered(true);
              }}
              onMouseLeave={scheduleHoverClose}
              onFocusCapture={() => setFocused(true)}
              onBlurCapture={(event) => {
                const nextTarget = event.relatedTarget as Node | null;
                if (nextTarget && panelRef.current?.contains(nextTarget)) return;
                setFocused(false);
              }}
            >
              <TooltipPanel data={data} tooltipId={tooltipId} pinned={pinned} />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
