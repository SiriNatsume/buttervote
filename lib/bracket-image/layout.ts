import type {
  BracketImageData,
  BracketImageMatch,
  BracketImageParticipant,
  BracketImageRound,
} from "./types";
import { BRACKET_IMAGE_HEIGHT, BRACKET_IMAGE_WIDTH } from "./types";
import { formatDateTime } from "../time";

export type BracketImageAssets = {
  logoDataUrl: string | null;
  participantImages: ReadonlyMap<string, string | null>;
};

type Position = {
  round: BracketImageRound;
  slot: number;
  x: number;
  y: number;
  width: number;
  number: number;
};

const C = {
  paper: "#FBF8F1", card: "#FFFDF9", ink: "#40362D", muted: "#8C7C6C",
  line: "#E5DCCC", orange: "#C96D3C", deepOrange: "#A94E28", win: "#FBF0E2",
};
const NODE_HEIGHT = 176;
const POSITIONS: Position[] = [
  ...Array.from({ length: 8 }, (_, i) => ({
    round: "round_of_16" as const, slot: i + 1,
    x: i < 4 ? 80 : 2480, y: 386 + (i % 4) * 264, width: 320, number: i + 1,
  })),
  ...Array.from({ length: 4 }, (_, i) => ({
    round: "quarterfinal" as const, slot: i + 1,
    x: i < 2 ? 466 : 2094, y: 518 + (i % 2) * 528, width: 320, number: i + 9,
  })),
  { round: "semifinal", slot: 1, x: 852, y: 782, width: 320, number: 13 },
  { round: "semifinal", slot: 2, x: 1708, y: 782, width: 320, number: 14 },
  { round: "final", slot: 1, x: 1240, y: 816, width: 400, number: 15 },
  { round: "third_place", slot: 1, x: 1240, y: 1166, width: 400, number: 16 },
];
const ROUND_LABEL: Record<BracketImageRound, string> = {
  round_of_16: "16 强", quarterfinal: "8 强", semifinal: "半决赛",
  final: "冠军赛", third_place: "季军赛",
};

function escapeXml(value: string | number) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function text(x: number, y: number, value: string | number, size = 22, fill = C.ink, weight = 500, attributes = "") {
  // Google's static subsets name 500/600 as separate families. resvg matches
  // those embedded family names, rather than CSS @font-face aliases.
  const family = weight === 600 ? "Noto Sans SC SemiBold" : weight === 500 ? "Noto Sans SC Medium" : "Noto Sans SC";
  return `<text x="${x}" y="${y}" font-family="${family}, Noto Sans SC, Microsoft YaHei, PingFang SC, sans-serif" font-size="${size}" fill="${fill}" font-weight="${weight}" ${attributes}>${escapeXml(value)}</text>`;
}

function rect(x: number, y: number, width: number, height: number, radius: number, fill: string, attributes = "") {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}" ${attributes}/>`;
}

function line(x1: number, y1: number, x2: number, y2: number, stroke = C.line, width = 2, attributes = "") {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${width}" ${attributes}/>`;
}

function key(round: BracketImageRound, slot: number) {
  return `${round}:${slot}`;
}

function units(value: string) {
  return Array.from(value).reduce((sum, char) => sum + (/^[\x20-\x7e]$/.test(char) ? 0.65 : 1), 0);
}

function wrap(value: string, maxUnits: number, maxLines: number) {
  const lines = [""];
  for (const char of Array.from(value)) {
    const index = lines.length - 1;
    if (units(lines[index] + char) > maxUnits) {
      if (lines.length === maxLines) {
        lines[index] = Array.from(lines[index]).slice(0, -1).join("") + "…";
        break;
      }
      lines.push(char);
    } else {
      lines[index] += char;
    }
  }
  return lines;
}

function nameLines(name: string, width: number) {
  if (units(name) * 22 <= width) return [{ value: name, size: 22 }];
  const parts = name.split("·");
  if (parts.length > 1) {
    const rest = `· ${parts.slice(1).join("·")}`;
    if (units(parts[0]) * 21 <= width && units(rest) * 17 <= width) {
      return [{ value: parts[0], size: 21 }, { value: rest, size: Math.min(19, width / units(rest)) }];
    }
  }
  const size = units(name) * 19 <= width * 2 ? 19 : 16;
  return wrap(name, width / size, size === 19 ? 2 : 3).map(value => ({ value, size }));
}

// Public live scores do not make an in-progress match a completed win.
function winner(match: BracketImageMatch | undefined) {
  if (!match?.resultVisible || !match.winnerEntryId || match.contest?.status === "voting") return null;
  return [match.left, match.right].find(p => p?.entryId === match.winnerEntryId) ?? null;
}

function status(match: BracketImageMatch | undefined) {
  if (!match?.contest) return "待生成";
  if (match.contest.status === "voting") return "投票中";
  if (winner(match)) return "已结束";
  if (match.contest.status === "closed" || match.contest.status === "published") {
    return match.resultVisible ? "等待晋级确认" : "结果待公开";
  }
  return "等待开始";
}

function dateLabel(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit",
  }).format(date).replace("/", ".");
}

function stageMeta(matches: BracketImageMatch[], expected: number) {
  if (matches.length === 0) return "赛程待定";
  const finished = matches.length === expected && matches.every(match => winner(match));
  const ends = matches.map(match => match.scheduledEndsAt ? Date.parse(match.scheduledEndsAt) : NaN);
  if (matches.length === expected && ends.every(Number.isFinite)) {
    const first = dateLabel(new Date(Math.min(...ends)).toISOString());
    const last = dateLabel(new Date(Math.max(...ends)).toISOString());
    return `${first === last ? last : `${first}–${last}`} ${finished ? "结束" : "截止"}`;
  }
  if (finished) return "已结束";
  if (matches.some(match => match.contest?.status === "voting")) return "投票中";
  if (matches.some(match => !match.resultVisible && match.contest?.status === "closed")) return "结果待公开";
  if (matches.every(match => status(match) === "等待开始")) return "等待开始";
  return "赛程进行中";
}

function tiebreakNote(match: BracketImageMatch | undefined) {
  const resolved = winner(match);
  // Before publication, displayed scores can exclude love-vote weights. Never
  // interpret an apparent tie in those partial scores as the final tiebreak.
  if (!resolved || match?.contest?.status !== "published" || !match.left || !match.right
    || match.left.score === null || match.left.score !== match.right.score) return "";
  const { left, right } = match;
  if (left.preliminaryGroup && left.preliminaryGroup === right.preliminaryGroup
    && typeof left.preliminaryRank === "number" && typeof right.preliminaryRank === "number"
    && left.preliminaryRank !== right.preliminaryRank) {
    return "同分判定：预赛同组排名更高者获胜";
  }
  if (typeof left.screeningRank === "number" && typeof right.screeningRank === "number" && left.screeningRank !== right.screeningRank) {
    return "同分判定：海选排名更高者获胜";
  }
  return "同分判定：按赛事规则决定胜者";
}

export function renderBracketImageLayout(data: BracketImageData, assets: BracketImageAssets) {
  const bySlot = new Map(data.matches.map(match => [key(match.round, match.slot), match]));
  const byPosition = new Map(POSITIONS.map(position => [key(position.round, position.slot), position]));
  const final = bySlot.get("final:1");
  const champion = winner(final);
  const matches = POSITIONS.flatMap(p => {
    const match = bySlot.get(key(p.round, p.slot));
    return match ? [match] : [];
  });

  function avatar(p: BracketImageParticipant | null, x: number, y: number, size: number, radius: number, id: string) {
    const url = p?.imagePath ? assets.participantImages.get(p.imagePath) : null;
    if (!url) {
      const label = p ? Array.from(p.name)[0] ?? "BV" : "待定";
      return rect(x, y, size, size, radius, "#F3EBDC")
        + text(x + size / 2, y + size / 2 + size * 0.12, label, size * 0.36, "#A18C6F", 500, 'text-anchor="middle"');
    }
    return `<clipPath id="${id}">${rect(x, y, size, size, radius, "#FFFFFF")}</clipPath>
      <image href="${escapeXml(url)}" x="${x}" y="${y}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/>`;
  }

  function row(p: BracketImageParticipant | null, match: BracketImageMatch | undefined, position: Position, index: number, scoreWidth: number) {
    const { x, y, width } = position;
    const cy = y + (index === 0 ? 48 : 128);
    if (!p) return text(x + width / 2, cy + 8, "待定", 22, C.muted, 500, 'text-anchor="middle"');
    const isWinner = winner(match)?.entryId === p.entryId;
    const score = match?.resultVisible && p.score !== null && Number.isFinite(p.score) ? String(p.score) : "";
    const lines = nameLines(p.name, width - 134 - scoreWidth);
    const lineHeight = lines.length === 3 ? 21 : 27;
    const startY = cy + 8 - (lines.length - 1) * lineHeight / 2;
    return `<g><title>${escapeXml(p.name)}</title>
      ${isWinner ? rect(x + 7, cy - 38, width - 14, 76, 12, C.win) : ""}
      ${isWinner ? rect(x + 1, cy - 22, 4, 44, 2, C.orange) : ""}
      ${avatar(p, x + 16, cy - 31, 62, 11, `avatar-${position.round}-${position.slot}-${index}`)}
      ${lines.map((l, i) => text(x + 93, startY + i * lineHeight, l.value, l.size, isWinner ? C.ink : "#73685F", isWinner ? 600 : 500)).join("")}
      ${score ? text(x + width - 32, cy + 11, score, Math.min(32, scoreWidth / units(score)), isWinner ? C.deepOrange : "#8C8276", 600, 'text-anchor="end"') : ""}
      ${isWinner ? text(x + width - 13, cy + 6, "胜", 14, C.deepOrange, 600, 'text-anchor="middle"') : ""}
    </g>`;
  }

  function card(position: Position) {
    const match = bySlot.get(key(position.round, position.slot));
    const { x, y, width, round } = position;
    const state = status(match);
    const isCentral = round === "final" || round === "third_place";
    const championMatch = champion && winner(match)?.entryId === champion.entryId;
    const scoreWidth = match?.resultVisible
      ? Math.max(32, ...[match.left, match.right].map(p => p?.score != null ? Math.min(110, units(String(p.score)) * 30) : 0))
      : 0;
    return `<g data-match="${key(round, position.slot)}">
      ${!isCentral ? text(x + 2, y - 14, String(position.number).padStart(2, "0"), 18, "#A39687", 500) : ""}
      ${!isCentral && state !== "已结束" ? text(x + width - 2, y - 14, state, 17, state === "投票中" ? C.deepOrange : C.muted, 500, 'text-anchor="end"') : ""}
      ${rect(x, y + 5, width, NODE_HEIGHT, 18, "#A18A62", 'opacity="0.055"')}
      ${rect(x, y, width, NODE_HEIGHT, 18, C.card, `stroke="${championMatch ? "#DAAD84" : "#E1D7C8"}" stroke-width="${championMatch ? 2 : 1.5}"`)}
      ${line(x + 18, y + 88, x + width - 18, y + 88, "#EEE5D9", 1)}
      ${row(match?.left ?? null, match, position, 0, scoreWidth)}
      ${row(match?.right ?? null, match, position, 1, scoreWidth)}
    </g>`;
  }

  function connection(fromKey: string, toKey: string, direction: number, defaultRow: number) {
    const from = byPosition.get(fromKey)!;
    const to = byPosition.get(toKey)!;
    const fromMatch = bySlot.get(fromKey);
    const toMatch = bySlot.get(toKey);
    const fromWinner = winner(fromMatch);
    const actualRow = fromWinner ? [toMatch?.left, toMatch?.right].findIndex(p => p?.entryId === fromWinner.entryId) : -1;
    const intoRow = actualRow < 0 ? defaultRow : actualRow;
    const highlight = champion && fromWinner?.entryId === champion.entryId && actualRow >= 0;
    const x1 = direction === 1 ? from.x + from.width : from.x;
    const x2 = direction === 1 ? to.x : to.x + to.width;
    const mid = (x1 + x2) / 2;
    const y1 = from.y + NODE_HEIGHT / 2;
    const y2 = to.y + (intoRow === 0 ? 48 : 128);
    const r = Math.min(10, Math.abs(y2 - y1) / 2);
    const signY = y2 > y1 ? 1 : -1;
    return `<path data-route="${fromKey}-${toKey}" data-champion-route="${Boolean(highlight)}" d="M${x1} ${y1} H${mid - direction * r} Q${mid} ${y1} ${mid} ${y1 + signY * r} V${y2 - signY * r} Q${mid} ${y2} ${mid + direction * r} ${y2} H${x2}" stroke="${highlight ? C.orange : "#D9CDBD"}" stroke-width="${highlight ? 4 : 2.5}" fill="none" stroke-linecap="round"/>`;
  }

  function thirdPlaceConnection(slot: number) {
    const from = byPosition.get(`semifinal:${slot}`)!;
    const fromMatch = bySlot.get(`semifinal:${slot}`);
    const to = byPosition.get("third_place:1")!;
    const toMatch = bySlot.get("third_place:1");
    const actualRow = fromMatch?.resultVisible && fromMatch.loserEntryId
      ? [toMatch?.left, toMatch?.right].findIndex(p => p?.entryId === fromMatch.loserEntryId) : -1;
    const intoRow = actualRow < 0 ? slot - 1 : actualRow;
    const cy = to.y + (intoRow === 0 ? 48 : 128);
    const x = from.x + from.width / 2;
    const direction = slot === 1 ? 1 : -1;
    return `<path d="M${x} ${from.y + NODE_HEIGHT} V${cy - 10} Q${x} ${cy} ${x + direction * 10} ${cy} H${slot === 1 ? to.x : to.x + to.width}" fill="none" stroke="#C6B7A3" stroke-width="2.5" stroke-dasharray="7 8"/>`;
  }

  const edges: string[] = [];
  for (let i = 1; i <= 8; i++) edges.push(connection(`round_of_16:${i}`, `quarterfinal:${Math.ceil(i / 2)}`, i <= 4 ? 1 : -1, (i - 1) % 2));
  for (let i = 1; i <= 4; i++) edges.push(connection(`quarterfinal:${i}`, `semifinal:${Math.ceil(i / 2)}`, i <= 2 ? 1 : -1, (i - 1) % 2));
  edges.push(connection("semifinal:1", "final:1", 1, 0), connection("semifinal:2", "final:1", -1, 1));

  function heading(x: number, round: BracketImageRound, slots: number[], width = 320) {
    const roundMatches = slots.flatMap(slot => { const match = bySlot.get(key(round, slot)); return match ? [match] : []; });
    return text(x + width / 2, 315, round === "final" ? "决赛" : ROUND_LABEL[round], 26, "#5F5040", 600, 'text-anchor="middle"')
      + text(x + width / 2, 349, stageMeta(roundMatches, slots.length), 18, C.muted, 400, 'text-anchor="middle"')
      + line(x + width / 2 - 20, 367, x + width / 2 + 20, 367, "#E2D4B9", 2);
  }

  const fullResult = matches.length === POSITIONS.length && matches.every(match => winner(match));
  const phase = fullResult ? "正赛已结束" : matches.some(match => match.contest?.status === "voting") ? "投票中"
    : matches.some(match => status(match) === "结果待公开") ? "等待结果公开"
      : matches.length && matches.every(match => status(match) === "等待开始") ? "等待开始"
        : matches.length ? "赛程进行中" : "等待赛程生成";
  const participantCount = new Set(matches.flatMap(match => [match.left?.entryId, match.right?.entryId]).filter(Boolean)).size;
  const summary = fullResult ? `${participantCount} 位参赛角色 · ${matches.length} 场对决 · ${phase}`
    : `${participantCount} 位已公开角色 · ${matches.length} 场已生成对阵 · ${phase}`;
  const titleSize = Math.min(66, Math.max(38, 2240 / Math.max(1, units(data.tournamentName))));
  const titleLines = wrap(data.tournamentName, 2240 / titleSize, 2);
  const championName = champion ? wrap(champion.name, 348 / 25, 1)[0] : "冠军待定";
  const versionMs = Number(data.visibilityVersion);
  const updatedAt = Number.isFinite(versionMs) && versionMs > 0 && Number.isFinite(new Date(versionMs).getTime())
    ? `数据更新 ${formatDateTime(new Date(versionMs))}` : "以活动当前公开赛果为准";

  function centralLabel(round: "final" | "third_place", y: number) {
    const state = status(bySlot.get(key(round, 1)));
    const label = ROUND_LABEL[round] + (state === "已结束" ? "" : ` · ${state}`);
    return text(1440, y, label, round === "final" ? 26 : 23, round === "final" ? C.deepOrange : "#8F7D65", 500, 'text-anchor="middle"');
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${BRACKET_IMAGE_WIDTH}" height="${BRACKET_IMAGE_HEIGHT}" viewBox="0 0 ${BRACKET_IMAGE_WIDTH} ${BRACKET_IMAGE_HEIGHT}" role="img" aria-labelledby="bracket-title">
  <title id="bracket-title">${escapeXml(data.tournamentName)} · 分享对阵图</title>
  <defs><linearGradient id="champion-paper" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F9E9B6"/><stop offset="1" stop-color="#FFF8E8"/></linearGradient></defs>
  ${rect(0, 0, BRACKET_IMAGE_WIDTH, BRACKET_IMAGE_HEIGHT, 0, C.paper)}
  ${rect(0, 0, BRACKET_IMAGE_WIDTH, 9, 0, "#F3D980")}
  ${rect(80, 72, 42, 6, 3, C.orange)}
  ${text(138, 81, fullResult ? "赛事对阵 · 全程赛果" : "赛事对阵 · 当前赛程", 21, "#8B6B45", 500)}
  ${titleLines.map((value, i) => text(76, titleLines.length === 1 ? 157 : 127 + i * 48, value, titleSize, C.ink, 600)).join("")}
  ${text(80, 211, summary, 23, C.muted, 400)}
  ${assets.logoDataUrl ? `<image href="${escapeXml(assets.logoDataUrl)}" x="2510" y="94" width="290" height="80" preserveAspectRatio="xMidYMid meet"/>` : text(2800, 157, "Butter Vote", 44, C.orange, 600, 'text-anchor="end"')}
  ${text(2798, 211, "buttervote.com", 23, "#A1896D", 500, 'text-anchor="end" letter-spacing="1"')}
  ${line(80, 256, 2800, 256, C.line, 1.5)}
  ${heading(80, "round_of_16", [1, 2, 3, 4])}${heading(466, "quarterfinal", [1, 2])}${heading(852, "semifinal", [1])}
  ${heading(1240, "final", [1], 400)}
  ${heading(1708, "semifinal", [2])}${heading(2094, "quarterfinal", [3, 4])}${heading(2480, "round_of_16", [5, 6, 7, 8])}
  ${edges.join("\n")}${thirdPlaceConnection(1)}${thirdPlaceConnection(2)}
  <g data-champion="${champion ? "revealed" : "pending"}">
    ${rect(1240, 389, 400, 329, 26, "#AD8850", 'opacity="0.07"')}
    ${rect(1240, 384, 400, 329, 26, "url(#champion-paper)", 'stroke="#E4C788" stroke-width="1.5"')}
    <path d="M1256 567 Q1294 602 1272 650 M1624 567 Q1586 602 1608 650" fill="none" stroke="#E8CF91" stroke-width="2"/>
    ${text(1440, 423, "冠  军", 23, "#946526", 600, 'text-anchor="middle"')}
    ${rect(1334, 444, 212, 212, 22, C.card, `stroke="#E9D9B5" stroke-width="1.5"${champion ? "" : ' stroke-dasharray="7 7"'}`)}
    ${champion ? avatar(champion, 1340, 450, 200, 17, "champion-avatar") : text(1440, 565, "待揭晓", 32, "#A18C6F", 500, 'text-anchor="middle"')}
    ${text(1440, 692, championName, 25, C.ink, 600, 'text-anchor="middle"')}
  </g>
  ${line(1440, 714, 1440, 748, champion ? C.orange : "#D9CDBD", 3)}
  <circle cx="1440" cy="751" r="4" fill="${champion ? C.orange : "#D9CDBD"}"/>
  ${centralLabel("final", 789)}
  ${text(1440, 1040, tiebreakNote(final), 19, "#947B5F", 400, 'text-anchor="middle"')}
  ${centralLabel("third_place", 1138)}
  ${POSITIONS.map(card).join("\n")}
  ${line(80, 1460, 2800, 1460, C.line, 1.5)}
  ${text(80, 1523, "BUTTER VOTE", 23, "#7A5C3D", 600, 'letter-spacing="3"')}
  ${text(80, 1564, "@SuperCUT Butter Group", 19, "#A08D76", 400)}
  ${rect(1080, 1497, 33, 33, 6, C.win)}${text(1096.5, 1521, "胜", 20, C.deepOrange, 600, 'text-anchor="middle"')}
  ${text(1128, 1523, "本场获胜", 21, C.muted, 400)}
  ${line(1317, 1515, 1371, 1515, C.orange, 4, 'stroke-linecap="round"')}${text(1387, 1523, "冠军晋级路线", 21, C.muted, 400)}
  ${line(1622, 1515, 1676, 1515, "#BFAF98", 2.5, 'stroke-dasharray="6 7"')}${text(1693, 1523, "季军赛路线", 21, C.muted, 400)}
  ${text(2800, 1523, "分享对阵图", 21, "#8E7B64", 400, 'text-anchor="end"')}
  ${text(2800, 1564, updatedAt, 18, "#A08D76", 400, 'text-anchor="end"')}
</svg>`;
}
