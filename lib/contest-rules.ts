import type {
  ClosedResultVisibility,
  Contest,
  ContestStatus,
  Profile,
  ScheduledTransitionTarget,
  VoteType,
} from "@/lib/types";
export { formatDateTime } from "@/lib/time";

export const contestStatuses = [
  "draft",
  "nominating",
  "admin_nominating",
  "waiting",
  "voting",
  "closed",
  "published",
] as const satisfies readonly ContestStatus[];

export const scheduledTransitionTargets = [
  "draft",
  "nominating",
  "admin_nominating",
  "waiting",
  "voting",
  "closed",
  "published",
] as const satisfies readonly ScheduledTransitionTarget[];

export const closedResultVisibilities = [
  "admin_only",
  "public",
] as const satisfies readonly ClosedResultVisibility[];

export const statusLabel: Record<ContestStatus, string> = {
  draft: "草稿",
  nominating: "提名中",
  admin_nominating: "管理员提名",
  waiting: "等待开始",
  voting: "投票中",
  closed: "已结束",
  published: "已发布",
};

export const voteTypeLabel: Record<VoteType, string> = {
  single: "单选",
  multiple: "多选",
  ranked: "排名投票",
};

export const closedResultVisibilityLabel: Record<ClosedResultVisibility, string> = {
  admin_only: "仅管理员可见",
  public: "公开结果",
};

export function canNominateByStatus(
  contest: Pick<Contest, "status">,
  profile?: Pick<Profile, "role"> | null,
) {
  if (contest.status === "nominating") {
    return true;
  }

  return contest.status === "admin_nominating" && profile?.role === "admin";
}

export function toDatetimeLocalValue(value?: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));

  return `${byType.get("year")}-${byType.get("month")}-${byType.get(
    "day",
  )}T${byType.get("hour")}:${byType.get("minute")}`;
}
