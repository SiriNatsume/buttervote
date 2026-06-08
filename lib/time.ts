const SHANGHAI_TIME_ZONE = "Asia/Shanghai";
const DEFAULT_EMPTY_TEXT = "未设置";

type DateInput = string | Date | null | undefined;

function toValidDate(value: DateInput) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateTime(value: DateInput): string {
  const date = toValidDate(value);

  if (!date) {
    return DEFAULT_EMPTY_TEXT;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: SHANGHAI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatDate(value: DateInput): string {
  const date = toValidDate(value);

  if (!date) {
    return DEFAULT_EMPTY_TEXT;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: SHANGHAI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatTime(value: DateInput): string {
  const date = toValidDate(value);

  if (!date) {
    return DEFAULT_EMPTY_TEXT;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: SHANGHAI_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}
