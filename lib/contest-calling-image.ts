import "server-only";

import { getPublicImageUrl } from "@/lib/image/image-url";
import type {
  ContestCallingEventPayload,
  ContestCallingScoreSnapshot,
} from "@/lib/contest-calling";

type CloudflareImageRequestInit = RequestInit & {
  cf?: {
    image?: {
      width?: number;
      height?: number;
      fit?: string;
      format?: string;
      quality?: number;
    };
  };
};

const CANVAS = {
  width: 1672,
  height: 941,
  background: "#FFF8E8",
};

const MAX_BACKGROUND_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const EMBEDDED_IMAGE_SIZE = 220;
const SCORE_ROW_COUNT = 4;

let shareBackgroundDataUrlPromise: Promise<string | null> | null = null;

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxChars: number) {
  const text = normalizeText(value);
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
}

function wrapText(value: string, maxChars: number, maxLines: number) {
  const text = normalizeText(value);
  if (!text) {
    return [];
  }

  const lines: string[] = [];
  let remaining = text;
  while (remaining.length > 0 && lines.length < maxLines) {
    if (remaining.length <= maxChars) {
      lines.push(remaining);
      remaining = "";
      break;
    }

    let splitAt = remaining.lastIndexOf(" ", maxChars);
    if (splitAt < Math.floor(maxChars * 0.55)) {
      splitAt = maxChars;
    }
    lines.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining && lines.length > 0) {
    lines[lines.length - 1] = truncateText(lines[lines.length - 1], maxChars);
  }

  return lines;
}

function renderTextLines({
  lines,
  x,
  y,
  fontSize,
  lineHeight,
  weight = 800,
  fill = "#5C321E",
}: {
  lines: string[];
  x: number;
  y: number;
  fontSize: number;
  lineHeight: number;
  weight?: number;
  fill?: string;
}) {
  return lines
    .map(
      (line, index) =>
        `<text x="${x}" y="${y + index * lineHeight}" font-size="${fontSize}" font-weight="${weight}" fill="${fill}">${escapeXml(line)}</text>`,
    )
    .join("\n");
}

function imageUrlForPath(imagePath: string | null) {
  if (!imagePath) {
    return null;
  }
  if (imagePath.startsWith("data:")) {
    return imagePath;
  }
  return getPublicImageUrl(imagePath);
}

function supportedImageContentType(bytes: Uint8Array, responseType: string) {
  const normalized = responseType.toLowerCase();
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
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

async function loadShareBackgroundDataUrl() {
  shareBackgroundDataUrlPromise ??= (async () => {
    try {
      const [{ readFile }, path] = await Promise.all([
        import("node:fs/promises"),
        import("node:path"),
      ]);
      const bytes = await readFile(path.join(process.cwd(), "img", "share.png"));
      if (bytes.byteLength > MAX_BACKGROUND_BYTES) {
        console.warn("Calling share background is too large to embed.");
        return null;
      }
      return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
    } catch (error) {
      console.warn("Failed to load calling share background; using fallback.", error);
      return null;
    }
  })();

  return shareBackgroundDataUrlPromise;
}

async function fetchImageDataUrl(imagePath: string | null) {
  const url = imageUrlForPath(imagePath);
  if (!url) {
    return null;
  }
  if (url.startsWith("data:")) {
    return url;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try {
    const init: CloudflareImageRequestInit = {
      cache: "force-cache",
      headers: { accept: "image/png,image/jpeg,*/*;q=0.1" },
      signal: controller.signal,
      cf: {
        image: {
          width: EMBEDDED_IMAGE_SIZE,
          height: EMBEDDED_IMAGE_SIZE,
          fit: "cover",
          format: "jpeg",
          quality: 90,
        },
      },
    };
    const response = await fetch(url, init);
    if (!response.ok) {
      return null;
    }
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > MAX_IMAGE_BYTES) {
      return null;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const contentType = supportedImageContentType(
      bytes,
      response.headers.get("content-type")?.split(";")[0] || "",
    );
    if (!contentType) {
      return null;
    }
    return `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch (error) {
    console.error("Failed to embed contest calling image asset.", error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function renderAvatar({
  x,
  y,
  size,
  imageDataUrl,
  name,
}: {
  x: number;
  y: number;
  size: number;
  imageDataUrl: string | null;
  name: string;
}) {
  const clipId = `calling-avatar-${Math.round(x)}-${Math.round(y)}`;
  const initials = normalizeText(name).slice(0, 2) || "候选";

  return `
    <clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${size}" height="${size}" rx="34" /></clipPath>
    <rect x="${x}" y="${y}" width="${size}" height="${size}" rx="34" fill="#FFF1CF" stroke="#F0D08A" stroke-width="4" />
    ${
      imageDataUrl
        ? `<image href="${escapeXml(imageDataUrl)}" x="${x}" y="${y}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})" />`
        : `<text x="${x + size / 2}" y="${y + size / 2 + 13}" text-anchor="middle" font-size="34" font-weight="900" fill="#B9854C">${escapeXml(initials)}</text>`
    }
  `;
}

function renderPill({
  x,
  y,
  text,
  fill,
  stroke,
  color,
  width,
}: {
  x: number;
  y: number;
  text: string;
  fill: string;
  stroke: string;
  color: string;
  width?: number;
}) {
  const pillWidth = width ?? Math.max(128, text.length * 18 + 34);
  return `
    <rect x="${x}" y="${y}" width="${pillWidth}" height="38" rx="19" fill="${fill}" stroke="${stroke}" stroke-width="2" />
    <text x="${x + pillWidth / 2}" y="${y + 25}" text-anchor="middle" font-size="18" font-weight="900" fill="${color}">${escapeXml(text)}</text>
  `;
}

function renderScoreRows(scores: ContestCallingScoreSnapshot[]) {
  const rows = scores.slice(0, SCORE_ROW_COUNT);
  if (rows.length === 0) {
    return `<text x="620" y="686" font-size="24" font-weight="800" fill="#9A6A35">等待唱票开始</text>`;
  }

  const rowX = 610;
  const rowWidth = 826;
  const rowHeight = 38;
  const startY = 656;
  const gap = 8;

  return rows
    .map((score, index) => {
      const y = startY + index * (rowHeight + gap);
      const fill = score.isCurrent ? "#ECFDF3" : "#FFFDF7";
      const stroke = score.isCurrent ? "#4DAA67" : "#EED8AA";
      const rankFill = score.isCurrent ? "#2F7A45" : "#B9854C";
      const name = truncateText(score.name, 20);

      return `
        <g>
          <rect x="${rowX}" y="${y}" width="${rowWidth}" height="${rowHeight}" rx="18" fill="${fill}" stroke="${stroke}" stroke-width="2" opacity="0.96" />
          <text x="${rowX + 22}" y="${y + 28}" font-size="20" font-weight="900" fill="${rankFill}">#${score.position}</text>
          <text x="${rowX + 84}" y="${y + 28}" font-size="20" font-weight="800" fill="#5C321E">${escapeXml(name)}</text>
          <text x="${rowX + rowWidth - 30}" y="${y + 28}" text-anchor="end" font-size="22" font-weight="950" fill="#2F7A45">${score.score} 分</text>
        </g>
      `;
    })
    .join("\n");
}

export async function renderContestCallingSvg(params: {
  contestTitle: string;
  sessionStatus: string;
  currentStep: number;
  totalSteps: number;
  event: ContestCallingEventPayload | null;
}) {
  const event = params.event;
  const [backgroundDataUrl, candidateImageDataUrl] = await Promise.all([
    loadShareBackgroundDataUrl(),
    event ? fetchImageDataUrl(event.candidateSnapshot.imagePath) : Promise.resolve(null),
  ]);
  const lovePhaseProgress =
    event?.phase === "love_bonus" &&
    typeof event.metadata.phaseStep === "number" &&
    typeof event.metadata.phaseTotal === "number" &&
    event.metadata.phaseStep > 0 &&
    event.metadata.phaseTotal > 0
      ? `真爱票第 ${event.metadata.phaseStep} 张 / 共 ${event.metadata.phaseTotal} 张`
      : null;
  const phaseLabel = event?.phase === "love_bonus" ? "真爱票加权" : "基础唱票";
  const phaseColor = event?.phase === "love_bonus" ? "#C73555" : "#2F7A45";
  const phaseFill = event?.phase === "love_bonus" ? "#FFE4EA" : "#ECFDF3";
  const phaseStroke = event?.phase === "love_bonus" ? "#FFB3C1" : "#9AD7A8";
  const statusLabel =
    params.sessionStatus === "completed"
      ? "唱票完成"
      : params.sessionStatus === "paused"
        ? "手动暂停"
        : params.sessionStatus === "active"
          ? "正在唱票"
          : "准备唱票";
  const deltaLabel = event
    ? event.phase === "love_bonus"
      ? `${event.deltaScore > 0 ? "+" : ""}${event.deltaScore} 加权分`
      : `${event.deltaScore > 0 ? "+" : ""}${event.deltaScore} 分`
    : "等待开始";
  const note =
    event?.phase === "love_bonus"
      ? "本张展示真爱票加权补充分。"
      : "本阶段展示实时总分，不含真爱票权重。";
  const titleLines = wrapText(params.contestTitle, 24, 2);
  const candidateNameLines = event
    ? wrapText(event.candidateSnapshot.name, 16, 2)
    : ["等待管理员开始唱票"];
  const progressText = `第 ${params.currentStep} 张 / 共 ${params.totalSteps} 张`;
  const phaseDetail = lovePhaseProgress ?? phaseLabel;
  const currentPanelStroke = event?.phase === "love_bonus" ? "#FFB3C1" : "#9AD7A8";

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS.width}" height="${CANVAS.height}" viewBox="0 0 ${CANVAS.width} ${CANVAS.height}">
  ${
    backgroundDataUrl
      ? `<image href="${escapeXml(backgroundDataUrl)}" x="0" y="0" width="${CANVAS.width}" height="${CANVAS.height}" preserveAspectRatio="xMidYMid meet" />`
      : `<rect x="0" y="0" width="${CANVAS.width}" height="${CANVAS.height}" fill="${CANVAS.background}" />`
  }
  <style>
    text { font-family: Inter, 'Noto Sans SC', 'Microsoft YaHei', sans-serif; letter-spacing: 0; }
  </style>

  ${renderTextLines({
    lines: titleLines,
    x: 586,
    y: 146,
    fontSize: titleLines.length > 1 ? 34 : 38,
    lineHeight: 42,
    weight: 950,
  })}
  ${renderPill({ x: 586, y: 222, text: phaseDetail, fill: phaseFill, stroke: phaseStroke, color: phaseColor })}
  ${renderPill({ x: 586 + Math.max(128, phaseDetail.length * 18 + 34) + 16, y: 222, text: progressText, fill: "#FFF8E8", stroke: "#E8CF9B", color: "#6A3E21", width: 196 })}
  ${renderPill({ x: 586 + Math.max(128, phaseDetail.length * 18 + 34) + 228, y: 222, text: statusLabel, fill: "#FFFDF7", stroke: "#E8CF9B", color: "#9A6A35", width: 142 })}

  <rect x="586" y="286" width="890" height="282" rx="34" fill="#FFFDF7" stroke="${currentPanelStroke}" stroke-width="3" opacity="0.96" />
  ${
    event
      ? `
        ${renderAvatar({ x: 626, y: 338, size: 178, imageDataUrl: candidateImageDataUrl, name: event.candidateSnapshot.name })}
        <text x="842" y="338" font-size="22" font-weight="900" fill="#B9854C">${escapeXml(phaseLabel)}</text>
        ${renderTextLines({ lines: candidateNameLines, x: 842, y: 390, fontSize: 38, lineHeight: 46, weight: 950 })}
        <text x="842" y="496" font-size="42" font-weight="950" fill="${phaseColor}">${escapeXml(deltaLabel)}</text>
        <text x="842" y="532" font-size="20" font-weight="800" fill="#9A6A35">${escapeXml(note)}</text>
      `
      : `<text x="1031" y="430" text-anchor="middle" font-size="34" font-weight="900" fill="#9A6A35">等待管理员开始唱票</text>`
  }

  <rect x="586" y="604" width="890" height="236" rx="30" fill="#FFFDF7" stroke="#EED8AA" stroke-width="3" opacity="0.94" />
  <text x="610" y="642" font-size="24" font-weight="950" fill="#5C321E">当前榜单 Top ${SCORE_ROW_COUNT}</text>
  <text x="1436" y="642" text-anchor="end" font-size="18" font-weight="800" fill="#9A6A35">数字为已唱出累计分</text>
  ${event ? renderScoreRows(event.scores) : renderScoreRows([])}
</svg>`;
}