"use client";

import Link from "next/link";
import { ArrowRight, Crown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import styles from "./hall-of-fame-journey-link.module.css";

export function HallOfFameJourneyLink({
  contestGroupId,
  winnerName,
  active,
}: {
  contestGroupId: string;
  winnerName: string;
  active: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const touchArmedRef = useRef(false);
  const pointerTypeRef = useRef("");

  useEffect(() => {
    if (!active) {
      touchArmedRef.current = false;
      setExpanded(false);
    }
  }, [active]);

  useEffect(() => {
    if (!expanded) return;

    function handleOutsidePointer(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !containerRef.current?.contains(event.target)
      ) {
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
        href={`/groups/${contestGroupId}`}
        prefetch={false}
        className={styles.link}
        aria-label={`回顾${winnerName}的夺冠历程`}
        aria-expanded={expanded}
        onPointerEnter={(event) => {
          if (event.pointerType !== "touch") setExpanded(true);
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
          pointerTypeRef.current = event.pointerType;
        }}
        onFocus={() => setExpanded(true)}
        onBlur={() => {
          touchArmedRef.current = false;
          setExpanded(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
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
