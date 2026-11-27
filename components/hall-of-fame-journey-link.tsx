"use client";

import Link from "next/link";
import { ArrowRight, Crown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import styles from "./hall-of-fame-journey-link.module.css";

const JOURNEY_HINT_DURATION_MS = 3000;

export function HallOfFameJourneyLink({
  href,
  winnerName,
  active,
  claimHint,
}: {
  href: string;
  winnerName: string;
  active: boolean;
  claimHint: () => boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [previousActive, setPreviousActive] = useState(active);
  const containerRef = useRef<HTMLDivElement>(null);
  const touchArmedRef = useRef(false);
  const pointerTypeRef = useRef("");
  const hintTimerRef = useRef<number | null>(null);

  if (previousActive !== active) {
    setPreviousActive(active);
    if (!active) setExpanded(false);
  }

  function cancelHintTimer() {
    if (hintTimerRef.current !== null) {
      window.clearTimeout(hintTimerRef.current);
      hintTimerRef.current = null;
    }
  }

  useEffect(() => {
    if (!active) {
      touchArmedRef.current = false;
      return;
    }

    // Defer until mount settles so effect replay cannot consume an unseen hint.
    hintTimerRef.current = window.setTimeout(() => {
      hintTimerRef.current = null;
      if (!claimHint()) return;
      setExpanded(true);
      hintTimerRef.current = window.setTimeout(() => {
        hintTimerRef.current = null;
        setExpanded(false);
      }, JOURNEY_HINT_DURATION_MS);
    }, 0);

    return cancelHintTimer;
  }, [active, claimHint]);

  useEffect(() => {
    if (!expanded) return;

    function handleOutsidePointer(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !containerRef.current?.contains(event.target)
      ) {
        cancelHintTimer();
        touchArmedRef.current = false;
        setExpanded(false);
      }
    }

    document.addEventListener("pointerdown", handleOutsidePointer);
    return () => document.removeEventListener("pointerdown", handleOutsidePointer);
  }, [expanded]);

  return (
    <div ref={containerRef} className={styles.slot} data-active={active}>
      <Link
        href={href}
        prefetch={false}
        className={styles.link}
        aria-label={`回顾${winnerName}的夺冠历程`}
        aria-expanded={expanded}
        onPointerEnter={(event) => {
          if (event.pointerType !== "touch") {
            cancelHintTimer();
            setExpanded(true);
          }
        }}
        onPointerLeave={(event) => {
          if (
            event.pointerType === "touch" ||
            touchArmedRef.current ||
            event.currentTarget.matches(":focus-visible")
          ) return;
          setExpanded(false);
        }}
        onPointerDown={(event) => {
          cancelHintTimer();
          pointerTypeRef.current = event.pointerType;
        }}
        onFocus={() => {
          cancelHintTimer();
          setExpanded(true);
        }}
        onBlur={() => {
          cancelHintTimer();
          touchArmedRef.current = false;
          setExpanded(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            cancelHintTimer();
            touchArmedRef.current = false;
            setExpanded(false);
          }
        }}
        onClick={(event) => {
          // Keyboard activation should follow the link immediately, even after a touch.
          const isTouch = event.detail !== 0 && (
            pointerTypeRef.current === "touch" ||
            window.matchMedia("(hover: none)").matches
          );
          if (isTouch && !touchArmedRef.current) {
            event.preventDefault();
            touchArmedRef.current = true;
            setExpanded(true);
          }
        }}
      >
        <span className={styles.crown}><Crown aria-hidden="true" /></span>
        <span className={styles.label}>回顾她的夺冠历程</span>
        <span className={styles.arrow}><ArrowRight aria-hidden="true" /></span>
      </Link>
    </div>
  );
}
