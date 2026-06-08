"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

function getRemaining(targetTime: string) {
  const targetTimestamp = new Date(targetTime).getTime();

  if (!Number.isFinite(targetTimestamp)) {
    return null;
  }

  const diff = targetTimestamp - Date.now();

  if (diff <= 0) {
    return null;
  }

  const totalMinutes = Math.floor(diff / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  return { days, hours, minutes };
}

export function Countdown({
  targetTime,
  prefix,
  expiredText = "时间已到，正在更新状态...",
  refreshOnExpire = false,
}: {
  targetTime: string;
  prefix: string;
  expiredText?: string;
  refreshOnExpire?: boolean;
}) {
  const router = useRouter();
  const refreshTriggeredRef = useRef(false);
  const [now, setNow] = useState(() => Date.now());
  const targetTimestamp = useMemo(() => new Date(targetTime).getTime(), [targetTime]);
  const remaining = useMemo(() => {
    void now;
    return getRemaining(targetTime);
  }, [now, targetTime]);
  const isExpired =
    Number.isFinite(targetTimestamp) && targetTimestamp <= now;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!refreshOnExpire || !isExpired || refreshTriggeredRef.current) {
      return;
    }

    refreshTriggeredRef.current = true;
    router.refresh();
  }, [isExpired, refreshOnExpire, router]);

  if (!remaining) {
    return <span className="text-muted-foreground">{expiredText}</span>;
  }

  return (
    <span>
      {prefix}
      {remaining.days > 0 ? `${remaining.days} 天 ` : ""}
      {remaining.hours} 小时 {remaining.minutes} 分钟
    </span>
  );
}
