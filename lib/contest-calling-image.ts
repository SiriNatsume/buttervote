import "server-only";

import { loadButterVoteLogoDataUrl, renderBrandSignatureSvg } from "@/lib/export-image/brand-signature";
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
  width: 1200,
  height: 720,
  background: "#FFF8E8",
};

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const EMBEDDED_IMAGE_SIZE = 220;

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
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
          quality: 92,
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
  const clipId = `avatar-${Math.round(x)}-${Math.round(y)}`;
  const initials = name.trim().slice(0, 2) || "候选";

  return `
    <clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${size}" height="${size}" rx="28" /></clipPath>
    <rect x="${x}" y="${y}" width="${size}" height="${size}" rx="28" fill="#FFF1CF" stroke="#F0D08A" stroke-width="3" />
    ${
      imageDataUrl
        ? `<image href="${escapeXml(imageDataUrl)}" x="${x}" y="${y}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})" />`
        : `<text x="${x + size / 2}" y="${y + size / 2 + 12}" text-anchor="middle" font-size="36" font-weight="800" fill="#B9854C">${escapeXml(initials)}</text>`
    }
  `;
}

function renderScoreRows(scores: ContestCallingScoreSnapshot[]) {
  return scores.slice(0, 8).map((score, index) => {
    const y = 222 + index * 50;
    const fill = score.isCurrent ? "#ECFDF3" : "#FFFDF7";
    const stroke = score.isCurrent ? "#4DAA67" : "#EED8AA";
    const name = score.name.length > 18 ? `${score.name.slice(0, 17)}…` : score.name;
    return `
      <g>
        <rect x="700" y="${y}" width="392" height="38" rx="16" fill="${fill}" stroke="${stroke}" stroke-width="2" />
        <text x="724" y="${y + 25}" font-size="20" font-weight="800" fill="#5C321E">${score.position}</text>
        <text x="764" y="${y + 25}" font-size="20" font-weight="700" fill="#5C321E">${escapeXml(name)}</text>
        <text x="1060" y="${y + 25}" text-anchor="end" font-size="22" font-weight="900" fill="#2F7A45">${score.score}</text>
      </g>
    `;
  }).join("");
}

export async function renderContestCallingSvg(params: {
  contestTitle: string;
  sessionStatus: string;
  currentStep: number;
  totalSteps: number;
  event: ContestCallingEventPayload | null;
}) {
  const event = params.event;
  const candidateImageDataUrl = event
    ? await fetchImageDataUrl(event.candidateSnapshot.imagePath)
    : null;
  const logoDataUrl = await loadButterVoteLogoDataUrl();
  const lovePhaseProgress =
    event?.phase === "love_bonus" &&
    typeof event.metadata.phaseStep === "number" &&
    typeof event.metadata.phaseTotal === "number" &&
    event.metadata.phaseStep > 0 &&
    event.metadata.phaseTotal > 0
      ? `真爱票第 ${event.metadata.phaseStep} 张 / 共 ${event.metadata.phaseTotal} 张`
      : null;
  const phaseLabel = event?.phase === "love_bonus" ? "真爱票加权" : "实时总分";
  const phaseDetailLabel = lovePhaseProgress ?? phaseLabel;
  const deltaLabel = event
    ? `${event.deltaScore > 0 ? "+" : ""}${event.deltaScore} 分`
    : "等待开始";
  const statusLabel =
    params.sessionStatus === "completed"
      ? "唱票完成"
      : params.sessionStatus === "paused"
        ? "手动暂停"
        : params.sessionStatus === "active"
          ? "正在唱票"
          : "准备唱票";
  const note =
    event?.phase === "love_bonus"
      ? "本张展示真爱票加权补充，最终总分会包含该加权。"
      : "本阶段展示实时总分，暂不包含真爱票权重。";

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS.width}" height="${CANVAS.height}" viewBox="0 0 ${CANVAS.width} ${CANVAS.height}">
  <rect width="${CANVAS.width}" height="${CANVAS.height}" fill="${CANVAS.background}" />
  <style>
    text { font-family: Inter, 'Noto Sans SC', 'Microsoft YaHei', sans-serif; }
  </style>
  <rect x="52" y="46" width="1096" height="86" rx="26" fill="#FFFDF7" stroke="#EED8AA" stroke-width="2" />
  <text x="84" y="84" font-size="26" font-weight="900" fill="#5C321E">${escapeXml(params.contestTitle)}</text>
  <text x="84" y="112" font-size="18" font-weight="700" fill="#9A6A35">${escapeXml(`第 ${params.currentStep} 张 / 共 ${params.totalSteps} 张 · ${statusLabel}${lovePhaseProgress ? ` · ${lovePhaseProgress}` : ""}`)}</text>
  <rect x="946" y="68" width="156" height="36" rx="18" fill="${event?.phase === "love_bonus" ? "#FFE4EA" : "#ECFDF3"}" stroke="${event?.phase === "love_bonus" ? "#FFB3C1" : "#9AD7A8"}" />
  <text x="1024" y="92" text-anchor="middle" font-size="18" font-weight="900" fill="${event?.phase === "love_bonus" ? "#C73555" : "#2F7A45"}">${escapeXml(phaseLabel)}</text>

  <rect x="70" y="172" width="568" height="376" rx="34" fill="#FFFDF7" stroke="#EED8AA" stroke-width="3" />
  ${
    event
      ? `
        ${renderAvatar({ x: 110, y: 222, size: 152, imageDataUrl: candidateImageDataUrl, name: event.candidateSnapshot.name })}
        <text x="292" y="258" font-size="22" font-weight="800" fill="#9A6A35">${escapeXml(phaseDetailLabel)}</text>
        <text x="292" y="306" font-size="40" font-weight="950" fill="#5C321E">${escapeXml(event.candidateSnapshot.name)}</text>
        <text x="292" y="356" font-size="34" font-weight="950" fill="${event.phase === "love_bonus" ? "#C73555" : "#2F7A45"}">${escapeXml(deltaLabel)}</text>
        <text x="110" y="434" font-size="22" font-weight="700" fill="#6A3E21">${escapeXml(note)}</text>
        <text x="110" y="476" font-size="18" font-weight="700" fill="#B9854C">数字表示当前已唱出的得分累计。</text>
      `
      : `<text x="354" y="350" text-anchor="middle" font-size="34" font-weight="900" fill="#9A6A35">等待管理员开始唱票</text>`
  }

  <rect x="672" y="172" width="448" height="440" rx="34" fill="#FFFDF7" stroke="#EED8AA" stroke-width="3" />
  <text x="700" y="210" font-size="24" font-weight="900" fill="#5C321E">当前进度榜</text>
  ${event ? renderScoreRows(event.scores) : ""}

  ${renderBrandSignatureSvg({ x: 52, y: 620, width: 1096, logoDataUrl })}
</svg>`;
}