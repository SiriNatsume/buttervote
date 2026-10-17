type ProfileDisplaySource = {
  qq_user_id?: string | null;
  qq_nickname?: string | null;
  qq_avatar_url?: string | null;
  display_name?: string | null;
  email?: string | null;
};

function text(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

export function getQQAvatarUrl(qq: string | null | undefined): string | null {
  const number = text(qq);
  return /^[1-9][0-9]{4,11}$/.test(number)
    ? `https://q1.qlogo.cn/g?b=qq&nk=${number}&s=100`
    : null;
}

export function getProfileAvatarUrl(profile?: ProfileDisplaySource | null): string | null {
  const qqAvatar = getQQAvatarUrl(profile?.qq_user_id);
  if (qqAvatar) return qqAvatar;
  const stored = text(profile?.qq_avatar_url);
  if (!stored) return null;
  try {
    const url = new URL(stored);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function getProfileDisplayName(profile?: ProfileDisplaySource | null, fallback = "未命名用户"): string {
  const nickname = text(profile?.qq_nickname);
  if (nickname) return nickname;
  const name = text(profile?.display_name);
  if (name) return name;
  if (getQQAvatarUrl(profile?.qq_user_id)) return `QQ 用户 ${text(profile?.qq_user_id).slice(-4)}`;
  return text(profile?.email) || fallback;
}

export function getQQTicketNickname(
  ticket: { qq_nickname: string | null; created_at: string },
  cached?: { nickname: string | null; observed_at: string | null } | null,
): string | null {
  const nickname = text(ticket.qq_nickname);
  const cachedNickname = text(cached?.nickname);
  if (cachedNickname && new Date(cached?.observed_at ?? "").getTime() > new Date(ticket.created_at).getTime()) {
    return cachedNickname;
  }
  return nickname || cachedNickname || null;
}
