"use client";

import { useEffect, useState } from "react";
import type { ContestRelativeTimeMode } from "@/lib/group-homepage";
import { formatDateTime } from "@/lib/time";

export function formatRelativeContestTime(
  target: string,
  now: number,
  mode: ContestRelativeTimeMode,
) {
  const targetTime = Date.parse(target);
  if (!Number.isFinite(targetTime)) return null;
  const difference = targetTime - now;
  const absoluteSeconds = Math.abs(difference) / 1000;
  if (absoluteSeconds < 45) {
    if (mode === "starts") return "即将开始";
    if (mode === "ends") return "即将结束";
    return "刚刚结束";
  }

  const units = [
    { seconds: 86400, label: "天" },
    { seconds: 3600, label: "小时" },
    { seconds: 60, label: "分钟" },
  ];
  const unit = units.find((candidate) => absoluteSeconds >= candidate.seconds) ?? units[2];
  const amount = Math.max(1, Math.floor(absoluteSeconds / unit.seconds));
  const suffix = mode === "starts" ? "后开始" : mode === "ends" ? "后结束" : "前结束";
  return `${amount}${unit.label}${suffix}`;
}

export function RelativeContestTime({
  target,
  referenceNow,
  mode,
}: {
  target: string | null;
  referenceNow: number;
  mode: ContestRelativeTimeMode | null;
}) {
  const [now, setNow] = useState(referenceNow);

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!target || !mode) return null;
  const relative = formatRelativeContestTime(target, now, mode);
  if (!relative) return null;
  return <time dateTime={target} title={formatDateTime(target)}>{relative}</time>;
}
