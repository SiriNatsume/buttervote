import "server-only";

import {
  loadButterVoteLogoDataUrl,
  renderBrandSignatureSvg,
} from "@/lib/export-image/brand-signature";
import { getPublicImageUrl } from "@/lib/image/image-url";
import type {
  BracketImageData,
  BracketImageMatch,
  BracketImageParticipant,
  BracketImageRound,
} from "@/lib/bracket-image/types";
import {
  BRACKET_IMAGE_HEIGHT,
  BRACKET_IMAGE_WIDTH,
} from "@/lib/bracket-image/types";

type MatchPosition = {
  round: BracketImageRound;
  slot: number;
  x: number;
  y: number;
};

type RenderParticipant = BracketImageParticipant & {
  imageDataUrl: string | null;
};

type RenderMatch = Omit<BracketImageMatch, "left" | "right"> & {
  left: RenderParticipant | null;
  right: RenderParticipant | null;
};

const CANVAS = {
  width: BRACKET_IMAGE_WIDTH,
  height: BRACKET_IMAGE_HEIGHT,
  background: "#FFF8E8",
};

const NODE = {
  width: 286,
  height: 178,
  radius: 18,
  headerHeight: 34,
  rowHeight: 62,
  rowGap: 8,
};

const CHAMPION_SLOT = {
  x: 1080,
  y: 170,
  width: 240,
  height: 148,
};

const POSITIONS: MatchPosition[] = [
  { round: "round_of_16", slot: 1, x: 76, y: 178 },
  { round: "round_of_16", slot: 2, x: 76, y: 412 },
  { round: "round_of_16", slot: 3, x: 76, y: 646 },
  { round: "round_of_16", slot: 4, x: 76, y: 880 },
  { round: "quarterfinal", slot: 1, x: 410, y: 295 },
  { round: "quarterfinal", slot: 2, x: 410, y: 763 },
  { round: "semifinal", slot: 1, x: 744, y: 529 },
  { round: "final", slot: 1, x: 1057, y: 408 },
  { round: "third_place", slot: 1, x: 1057, y: 650 },
  { round: "semifinal", slot: 2, x: 1370, y: 529 },
  { round: "quarterfinal", slot: 3, x: 1704, y: 295 },
  { round: "quarterfinal", slot: 4, x: 1704, y: 763 },
  { round: "round_of_16", slot: 5, x: 2038, y: 178 },
  { round: "round_of_16", slot: 6, x: 2038, y: 412 },
  { round: "round_of_16", slot: 7, x: 2038, y: 646 },
  { round: "round_of_16", slot: 8, x: 2038, y: 880 },
];

const ROUND_LABEL: Record<BracketImageRound, string> = {
  round_of_16: "16 强",
  quarterfinal: "8 强",
  semifinal: "半决赛",
  final: "冠军赛",
  third_place: "季军赛",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "未开始",
  waiting: "等待开始",
  voting: "投票中",
  closed: "结果待公开",
  published: "已公开",
};

const CONNECTORS: Array<{
  from: [BracketImageRound, number];
  to: [BracketImageRound, number];
  direction: "ltr" | "rtl";
  highlight?: boolean;
}> = [
  { from: ["round_of_16", 1], to: ["quarterfinal", 1], direction: "ltr" },
  { from: ["round_of_16", 2], to: ["quarterfinal", 1], direction: "ltr" },
  { from: ["round_of_16", 3], to: ["quarterfinal", 2], direction: "ltr" },
  { from: ["round_of_16", 4], to: ["quarterfinal", 2], direction: "ltr" },
  { from: ["quarterfinal", 1], to: ["semifinal", 1], direction: "ltr" },
  { from: ["quarterfinal", 2], to: ["semifinal", 1], direction: "ltr" },
  { from: ["semifinal", 1], to: ["final", 1], direction: "ltr", highlight: true },
  { from: ["round_of_16", 5], to: ["quarterfinal", 3], direction: "rtl" },
  { from: ["round_of_16", 6], to: ["quarterfinal", 3], direction: "rtl" },
  { from: ["round_of_16", 7], to: ["quarterfinal", 4], direction: "rtl" },
  { from: ["round_of_16", 8], to: ["quarterfinal", 4], direction: "rtl" },
  { from: ["quarterfinal", 3], to: ["semifinal", 2], direction: "rtl" },
  { from: ["quarterfinal", 4], to: ["semifinal", 2], direction: "rtl" },
  { from: ["semifinal", 2], to: ["final", 1], direction: "rtl", highlight: true },
  { from: ["semifinal", 1], to: ["third_place", 1], direction: "ltr" },
  { from: ["semifinal", 2], to: ["third_place", 1], direction: "rtl" },
];

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function key(round: BracketImageRound, slot: number) {
  return `${round}:${slot}`;
}

function unitLength(char: string) {
  return char.charCodeAt(0) < 128 ? 0.58 : 1;
}

function fitText(value: string, maxUnits: number) {
  let units = 0;
  let output = "";
  for (const char of Array.from(value)) {
    const nextUnits = units + unitLength(char);
    if (nextUnits > maxUnits) {
      return `${output}…`;
    }
    output += char;
    units = nextUnits;
  }
  return output;
}

function formatMeta(participant: BracketImageParticipant) {
  const parts: string[] = [];

  if (participant.preliminaryGroup) {
    parts.push(`${participant.preliminaryGroup} 组`);
  }
  if (typeof participant.preliminaryRank === "number") {
    parts.push(`预赛第 ${participant.preliminaryRank}`);
  }
  if (typeof participant.screeningRank === "number") {
    parts.push(`海选第 ${participant.screeningRank}`);
  }

  return parts.length > 0 ? parts.join(" · ") : "赛程席位";
}

function statusLabel(match: RenderMatch | null) {
  if (!match?.contest) {
    return "\u5f85\u751f\u6210";
  }

  if (match.resultVisible) {
    return "\u7ed3\u679c\u53ef\u89c1";
  }

  return STATUS_LABEL[match.contest.status] ?? null;
}

function championFromFinal(match: RenderMatch | null) {
  if (!match?.resultVisible || !match.winnerEntryId) {
    return null;
  }

  return (
    [match.left, match.right].find(
      (participant) => participant?.entryId === match.winnerEntryId,
    ) ?? null
  );
}

type CloudflareImageRequestInit = RequestInit & {
  cf?: {
    image?: {
      width?: number;
      height?: number;
      fit?: "cover" | "contain" | "scale-down" | "crop" | "pad";
      format?: "jpeg";
      quality?: number;
    };
  };
};

const MAX_EMBEDDED_IMAGE_BYTES = 4 * 1024 * 1024;
const EMBEDDED_PARTICIPANT_IMAGE_SIZE = 512;

function imageUrlForPath(imagePath: string) {
  if (/^https?:\/\//i.test(imagePath) || imagePath.startsWith("data:")) {
    return imagePath;
  }

  return getPublicImageUrl(imagePath);
}

function supportedImageContentType(bytes: Uint8Array, contentType: string) {
  const normalized = contentType.toLowerCase();
  const isPng =
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47;
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

  if (isPng) {
    return "image/png";
  }
  if (isJpeg) {
    return "image/jpeg";
  }
  if (normalized === "image/png" || normalized === "image/jpeg") {
    return normalized;
  }

  return null;
}

function imageFetchInit(signal: AbortSignal): CloudflareImageRequestInit {
  return {
    cache: "force-cache",
    headers: { accept: "image/png,image/jpeg,*/*;q=0.1" },
    signal,
    cf: {
      image: {
        width: EMBEDDED_PARTICIPANT_IMAGE_SIZE,
        height: EMBEDDED_PARTICIPANT_IMAGE_SIZE,
        fit: "cover",
        format: "jpeg",
        quality: 92,
      },
    },
  };
}

async function fetchImageDataUrl(imagePath: string | null) {
  if (!imagePath) {
    return null;
  }

  if (imagePath.startsWith("data:")) {
    return imagePath;
  }

  const url = imageUrlForPath(imagePath);
  if (!url) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try {
    const response = await fetch(url, imageFetchInit(controller.signal));

    if (!response.ok) {
      return null;
    }

    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > MAX_EMBEDDED_IMAGE_BYTES) {
      console.error("Bracket image asset is too large to embed.", {
        imagePath,
        contentLength,
      });
      return null;
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    const contentType = supportedImageContentType(
      bytes,
      response.headers.get("content-type")?.split(";")[0] || "",
    );

    if (!contentType) {
      console.error("Bracket image asset type is not supported by resvg.", {
        imagePath,
        responseType: response.headers.get("content-type"),
      });
      return null;
    }

    return `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch (error) {
    console.error("Failed to embed bracket image asset.", error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function embedParticipantImages(matches: BracketImageMatch[]) {
  const paths = [
    ...new Set(
      matches
        .flatMap((match) => [match.left?.imagePath, match.right?.imagePath])
        .filter((imagePath): imagePath is string => Boolean(imagePath)),
    ),
  ];
  const dataUrls = new Map<string, string | null>();

  await Promise.all(
    paths.map(async (imagePath) => {
      dataUrls.set(imagePath, await fetchImageDataUrl(imagePath));
    }),
  );

  return matches.map((match) => ({
    ...match,
    left: match.left
      ? {
          ...match.left,
          imageDataUrl: match.left.imagePath
            ? dataUrls.get(match.left.imagePath) ?? null
            : null,
        }
      : null,
    right: match.right
      ? {
          ...match.right,
          imageDataUrl: match.right.imagePath
            ? dataUrls.get(match.right.imagePath) ?? null
            : null,
        }
      : null,
  })) satisfies RenderMatch[];
}

function renderConnector(
  from: MatchPosition,
  to: MatchPosition,
  direction: "ltr" | "rtl",
  highlight = false,
) {
  const fromX = direction === "ltr" ? from.x + NODE.width : from.x;
  const toX = direction === "ltr" ? to.x : to.x + NODE.width;
  const fromY = from.y + NODE.height / 2;
  const toY = to.y + NODE.height / 2;
  const midX = direction === "ltr" ? fromX + 24 : fromX - 24;
  const stroke = highlight ? "#65A96E" : "#D5B77A";
  const opacity = highlight ? "0.95" : "0.78";

  return `<path d="M ${fromX} ${fromY} H ${midX} V ${toY} H ${toX}" fill="none" stroke="${stroke}" stroke-width="${highlight ? 5 : 4}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}" />`;
}

function renderChampionConnector() {
  const centerX = CHAMPION_SLOT.x + CHAMPION_SLOT.width / 2;
  const y1 = CHAMPION_SLOT.y + CHAMPION_SLOT.height;
  const y2 = 408;

  return `<path d="M ${centerX} ${y1} V ${y2}" fill="none" stroke="#65A96E" stroke-width="5" stroke-linecap="round" opacity="0.88" />`;
}

function renderCrown(cx: number, y: number) {
  return `
    <path d="M ${cx - 30} ${y + 34} L ${cx - 23} ${y + 8} L ${cx - 8} ${y + 25} L ${cx} ${y} L ${cx + 8} ${y + 25} L ${cx + 23} ${y + 8} L ${cx + 30} ${y + 34} Z" fill="#F0C45C" stroke="#D6A539" stroke-width="3" stroke-linejoin="round" />
    <circle cx="${cx - 23}" cy="${y + 8}" r="4" fill="#FFF4D8" />
    <circle cx="${cx}" cy="${y}" r="4" fill="#FFF4D8" />
    <circle cx="${cx + 23}" cy="${y + 8}" r="4" fill="#FFF4D8" />
  `;
}

function renderChampionSlot(champion: RenderParticipant | null) {
  const { x, y, width, height } = CHAMPION_SLOT;
  const centerX = x + width / 2;
  const crownY = y - 27;

  if (!champion) {
    return `
      <g>
        ${renderCrown(centerX, crownY)}
        <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="22" fill="#FFF4D8" stroke="#F0C45C" stroke-width="3" />
        <text x="${centerX}" y="${y + 54}" text-anchor="middle" font-size="18" font-weight="900" fill="#B9854C">\u51a0\u519b</text>
        <rect x="${x + 36}" y="${y + 76}" width="${width - 72}" height="42" rx="14" fill="#FFFCF4" stroke="#EED8AA" stroke-dasharray="8 7" />
        <text x="${centerX}" y="${y + 103}" text-anchor="middle" font-size="18" font-weight="800" fill="#8A6A45">\u5f85\u5b9a</text>
      </g>
    `;
  }

  return `
    <g>
      ${renderCrown(centerX, crownY)}
      <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="22" fill="#FFF4D8" stroke="#F0C45C" stroke-width="3" />
      <rect x="${x + 76}" y="${y + 16}" width="88" height="88" rx="22" fill="#FFFCF4" stroke="#F0C45C" stroke-width="3" />
      ${
        champion.imageDataUrl
          ? `
            <clipPath id="champion-image-clip">
              <rect x="${x + 82}" y="${y + 22}" width="76" height="76" rx="19" />
            </clipPath>
            <image href="${escapeXml(champion.imageDataUrl)}" x="${x + 82}" y="${y + 22}" width="76" height="76" preserveAspectRatio="xMidYMid slice" image-rendering="optimizeQuality" clip-path="url(#champion-image-clip)" />
          `
          : `<text x="${centerX}" y="${y + 70}" text-anchor="middle" font-size="22" font-weight="900" fill="#B9854C">BV</text>`
      }
      <text x="${centerX}" y="${y + 122}" text-anchor="middle" font-size="15" font-weight="900" fill="#B9854C">\u51a0\u519b</text>
      <text x="${centerX}" y="${y + 144}" text-anchor="middle" font-size="22" font-weight="900" fill="#3F2418">${escapeXml(fitText(champion.name, 9.5))}</text>
    </g>
  `;
}

function renderParticipantRow(params: {
  participant: RenderParticipant | null;
  x: number;
  y: number;
  width: number;
  resultVisible: boolean;
  clipId: string;
}) {
  const { participant, x, y, width, resultVisible, clipId } = params;
  const height = NODE.rowHeight;

  if (!participant) {
    return `
      <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="14" fill="#FFFFFF" fill-opacity="0.48" stroke="#EED8AA" stroke-width="2" stroke-dasharray="8 7" />
      <text x="${x + width / 2}" y="${y + 39}" text-anchor="middle" font-size="18" font-weight="700" fill="#8A6A45">待定</text>
    `;
  }

  const avatarSize = 54;
  const avatarX = x + 8;
  const avatarY = y + 4;
  const scoreVisible = resultVisible && participant.score !== null;
  const scoreText = scoreVisible ? String(participant.score) : "";
  const scoreWidth = scoreVisible
    ? Math.max(38, scoreText.length * 12 + 20)
    : 0;
  const scoreX = x + width - scoreWidth - 10;
  const textX = x + 76;
  const textRight = scoreVisible ? scoreX - 8 : x + width - 10;
  const textWidth = Math.max(72, textRight - textX);
  const nameMaxUnits = Math.max(4.5, textWidth / 19);
  const metaMaxUnits = Math.max(6.5, textWidth / 12);
  const rowFill =
    participant.isWinner && resultVisible ? "#F7FEF5" : "#FFFFFF";
  const rowStroke =
    participant.isWinner && resultVisible ? "#9ACF9E" : "#EED8AA";
  const leftStripe =
    participant.isWinner && resultVisible
      ? `<rect x="${x}" y="${y}" width="6" height="${height}" rx="3" fill="#3C8B4F" />`
      : "";
  const image = participant.imageDataUrl
    ? `
      <clipPath id="${clipId}">
        <rect x="${avatarX}" y="${avatarY}" width="${avatarSize}" height="${avatarSize}" rx="15" />
      </clipPath>
      <image href="${escapeXml(participant.imageDataUrl)}" x="${avatarX}" y="${avatarY}" width="${avatarSize}" height="${avatarSize}" preserveAspectRatio="xMidYMid slice" image-rendering="optimizeQuality" clip-path="url(#${clipId})" />
    `
    : `
      <rect x="${avatarX}" y="${avatarY}" width="${avatarSize}" height="${avatarSize}" rx="15" fill="#F7EAD0" />
      <text x="${avatarX + avatarSize / 2}" y="${avatarY + 35}" text-anchor="middle" font-size="15" font-weight="800" fill="#B9854C">BV</text>
    `;

  return `
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="14" fill="${rowFill}" fill-opacity="0.88" stroke="${rowStroke}" stroke-width="2" />
    ${leftStripe}
    ${image}
    <text x="${textX}" y="${y + 25}" font-size="19" font-weight="800" fill="#3F2418">${escapeXml(fitText(participant.name, nameMaxUnits))}</text>
    <text x="${textX}" y="${y + 48}" font-size="12" font-weight="700" fill="#7A6040">${escapeXml(fitText(formatMeta(participant), metaMaxUnits))}</text>
    ${
      scoreVisible
        ? `
          <rect x="${scoreX}" y="${y + 11}" width="${scoreWidth}" height="40" rx="11" fill="#FFF8E8" stroke="#EED8AA" />
          <text x="${scoreX + scoreWidth / 2}" y="${y + 35}" text-anchor="middle" font-size="18" font-weight="900" fill="${participant.isWinner ? "#2F7A42" : "#5C321E"}">${scoreText}</text>
        `
        : ""
    }
  `;
}

function renderMatchNode(params: {
  position: MatchPosition;
  match: RenderMatch | null;
  clipSeed: string;
}) {
  const { position, match, clipSeed } = params;
  const { x, y, round, slot } = position;
  const label = ROUND_LABEL[round];
  const pill = statusLabel(match);
  const fill = match ? "#FFFCF4" : "#FFF3D0";
  const stroke = match ? "#EED8AA" : "#E6C98C";
  const isFinal = round === "final";

  return `
    <g>
      <rect x="${x}" y="${y}" width="${NODE.width}" height="${NODE.height}" rx="${NODE.radius}" fill="${isFinal ? "#F1FAEF" : fill}" stroke="${isFinal ? "#74B87A" : stroke}" stroke-width="2.4" />
      <text x="${x + 16}" y="${y + 25}" font-size="15" font-weight="900" fill="#7A6040">${label} · 第 ${slot} 场</text>
      ${
        pill
          ? `
            <rect x="${x + NODE.width - 88}" y="${y + 10}" width="72" height="24" rx="12" fill="${match?.contest?.status === "voting" ? "#FFE4EA" : "#FFF8E8"}" stroke="#EED8AA" />
            <text x="${x + NODE.width - 52}" y="${y + 27}" text-anchor="middle" font-size="12" font-weight="800" fill="#8A6A45">${escapeXml(pill)}</text>
          `
          : ""
      }
      ${renderParticipantRow({
        participant: match?.left ?? null,
        x: x + 12,
        y: y + NODE.headerHeight + 10,
        width: NODE.width - 24,
        resultVisible: match?.resultVisible ?? false,
        clipId: `${clipSeed}-left`,
      })}
      ${renderParticipantRow({
        participant: match?.right ?? null,
        x: x + 12,
        y: y + NODE.headerHeight + 10 + NODE.rowHeight + NODE.rowGap,
        width: NODE.width - 24,
        resultVisible: match?.resultVisible ?? false,
        clipId: `${clipSeed}-right`,
      })}
    </g>
  `;
}

function renderLegend(x: number, y: number) {
  return `
    <g>
      <rect x="${x}" y="${y}" width="138" height="30" rx="15" fill="#F4FBF1" stroke="#D7EBCB" />
      <rect x="${x + 15}" y="${y + 9}" width="28" height="12" rx="6" fill="#3C8B4F" />
      <text x="${x + 54}" y="${y + 21}" font-size="14" font-weight="800" fill="#7A6040">\u7eff\u8272 = \u83b7\u80dc</text>
      <rect x="${x + 154}" y="${y}" width="148" height="30" rx="15" fill="#FFFFFF" fill-opacity="0.72" stroke="#EED8AA" />
      <text x="${x + 228}" y="${y + 21}" text-anchor="middle" font-size="14" font-weight="800" fill="#7A6040">\u6570\u5b57 = \u5f97\u7968</text>
    </g>
  `;
}

export async function renderBracketImageSvg(data: BracketImageData) {
  const renderedMatches = await embedParticipantImages(data.matches);
  const matchBySlot = new Map(
    renderedMatches.map((match) => [key(match.round, match.slot), match]),
  );
  const positionBySlot = new Map(
    POSITIONS.map((position) => [key(position.round, position.slot), position]),
  );
  const logoDataUrl = await loadButterVoteLogoDataUrl();
  const finalMatch = matchBySlot.get(key("final", 1)) ?? null;
  const champion = championFromFinal(finalMatch);
  const connectors = CONNECTORS.map((connector) => {
    const from = positionBySlot.get(key(connector.from[0], connector.from[1]));
    const to = positionBySlot.get(key(connector.to[0], connector.to[1]));

    return from && to
      ? renderConnector(from, to, connector.direction, connector.highlight)
      : "";
  }).join("\n");
  const nodes = POSITIONS.map((position, index) =>
    renderMatchNode({
      position,
      match: matchBySlot.get(key(position.round, position.slot)) ?? null,
      clipSeed: `clip-${index}`,
    }),
  ).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS.width}" height="${CANVAS.height}" viewBox="0 0 ${CANVAS.width} ${CANVAS.height}">
  <style>
    text {
      font-family: "Noto Sans SC", "Microsoft YaHei", "Microsoft YaHei UI", "PingFang SC", "Noto Sans CJK SC", "Source Han Sans SC", "Arial Unicode MS", sans-serif;
      letter-spacing: 0;
    }
  </style>
  <rect x="0" y="0" width="${CANVAS.width}" height="${CANVAS.height}" fill="${CANVAS.background}" />
  <rect x="38" y="36" width="${CANVAS.width - 76}" height="1170" rx="36" fill="#FFFCF4" fill-opacity="0.72" stroke="#EED8AA" stroke-width="2" />
  ${renderChampionConnector()}
  <g opacity="1">${connectors}</g>
  ${renderChampionSlot(champion)}
  <g>${nodes}</g>
  <text x="${CANVAS.width / 2}" y="940" text-anchor="middle" font-size="44" font-weight="900" fill="#4A2B1B">${escapeXml(fitText(data.tournamentName, 30))}</text>
  ${renderLegend(CANVAS.width / 2 - 151, 968)}
  ${renderBrandSignatureSvg({
    x: 0,
    y: 1214,
    width: CANVAS.width,
    logoDataUrl,
  })}
</svg>`;
}
