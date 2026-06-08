const NETWORK_ERROR = "网络异常，请稍后重试。";

function hasChineseText(value: string) {
  return /[\u4e00-\u9fff]/.test(value);
}

export function toUserFacingError(message?: string | null) {
  const text = String(message ?? "").trim();

  if (!text) {
    return NETWORK_ERROR;
  }

  if (/fetch failed|failed to fetch|network|timeout|timed out|econnreset/i.test(text)) {
    return NETWORK_ERROR;
  }

  if (/invalid login credentials/i.test(text)) {
    return "邮箱或密码错误，请检查后重试。";
  }

  if (/jwt|session|token|expired|invalid login|not authenticated|auth/i.test(text)) {
    return "登录已过期，请重新登录后再试。";
  }

  if (/permission|not authorized|forbidden|row-level security|rls|policy|403/i.test(text)) {
    return "权限不足，请确认当前账号是否有权限后重试。";
  }

  if (/duplicate key|unique constraint/i.test(text)) {
    return "你已经提交过，请勿重复操作。";
  }

  if (/quota|love vote/i.test(text)) {
    return "真爱票额度不足，请减少真爱票数量后再提交。";
  }

  if (/mime|unsupported|file type|image type|format/i.test(text)) {
    return "图片格式不支持，请上传 JPG、PNG 或 WebP 图片。";
  }

  if (hasChineseText(text)) {
    return text;
  }

  return "操作失败，请刷新页面后重试。";
}
