"use client";

import { useState } from "react";
import { Download, Share2 } from "lucide-react";
import { toast } from "sonner";
import logo from "@/img/网站logo.png";
import { Button } from "@/components/ui/button";

type ShareParticipant = {
  entryId: string;
  name: string;
  imagePath: string | null;
  seedLabel: string | null;
  score: number | null;
  isWinner: boolean;
};

type ShareMatch = {
  round: string;
  slot: number;
  contest: { status: string } | null;
  left: ShareParticipant | null;
  right: ShareParticipant | null;
  resultVisible: boolean;
  winnerEntryId: string | null;
};

type ShareBracket = {
  tournament: {
    name: string;
    status: string;
  };
  rounds: Array<{
    key: string;
    matches: ShareMatch[];
  }>;
  hasVotingMatch: boolean;
};

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  nominating: "提名中",
  admin_nominating: "管理员提名",
  waiting: "等待开始",
  voting: "投票中",
  closed: "已结束",
  published: "已发布",
};

const ROUND_LABEL: Record<string, string> = {
  round_of_16: "16 强",
  quarterfinal: "8 强",
  semifinal: "半决赛",
  final: "冠军赛",
  third_place: "季军赛",
};

const CANVAS_WIDTH = 2400;
const CANVAS_HEIGHT = 1400;
const NODE_WIDTH = 260;
const CENTER_WIDTH = 300;
const NODE_HEIGHT = 132;
const PARTICIPANT_HEIGHT = 46;

function imageSource(src: string | { src: string }) {
  return typeof src === "string" ? src : src.src;
}

function publicVoteImageUrl(imagePath?: string | null) {
  if (!imagePath) {
    return null;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    return null;
  }

  const encodedPath = imagePath.split("/").map(encodeURIComponent).join("/");
  return `${supabaseUrl}/storage/v1/object/public/vote-images/${encodedPath}`;
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.lineTo(x + width - safeRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  ctx.lineTo(x + width, y + height - safeRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  ctx.lineTo(x + safeRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  ctx.lineTo(x, y + safeRadius);
  ctx.quadraticCurveTo(x, y, x + safeRadius, y);
  ctx.closePath();
}

function fillRoundedRect(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  radius: number,
  fill: string,
  stroke?: string,
  lineWidth = 2,
) {
  roundedRect(ctx, rect.x, rect.y, rect.width, rect.height, radius);
  ctx.fillStyle = fill;
  ctx.fill();

  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

function drawTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
) {
  const chars = Array.from(text);
  const lines: string[] = [];
  let current = "";

  for (const char of chars) {
    const next = current + char;
    if (ctx.measureText(next).width <= maxWidth || current.length === 0) {
      current = next;
      continue;
    }

    lines.push(current);
    current = char;
    if (lines.length === maxLines) {
      break;
    }
  }

  if (lines.length < maxLines && current) {
    lines.push(current);
  }

  const visibleLines = lines.slice(0, maxLines);
  if (chars.join("").length > visibleLines.join("").length && visibleLines.length > 0) {
    let lastLine = visibleLines[visibleLines.length - 1];
    while (lastLine.length > 0 && ctx.measureText(`${lastLine}…`).width > maxWidth) {
      lastLine = lastLine.slice(0, -1);
    }
    visibleLines[visibleLines.length - 1] = `${lastLine}…`;
  }

  visibleLines.forEach((line, index) => {
    ctx.fillText(line, x, y + index * lineHeight);
  });
}

function drawImageCover(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  ctx.save();
  roundedRect(ctx, x, y, width, height, radius);
  ctx.clip();

  const imageRatio = image.naturalWidth / image.naturalHeight;
  const targetRatio = width / height;
  let sourceWidth = image.naturalWidth;
  let sourceHeight = image.naturalHeight;
  let sourceX = 0;
  let sourceY = 0;

  if (imageRatio > targetRatio) {
    sourceWidth = image.naturalHeight * targetRatio;
    sourceX = (image.naturalWidth - sourceWidth) / 2;
  } else {
    sourceHeight = image.naturalWidth / targetRatio;
    sourceY = (image.naturalHeight - sourceHeight) / 2;
  }

  ctx.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    x,
    y,
    width,
    height,
  );
  ctx.restore();
}

function drawPlaceholderIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.save();
  ctx.strokeStyle = "#B9854C";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(x + size * 0.24, y + size * 0.72);
  ctx.lineTo(x + size * 0.76, y + size * 0.72);
  ctx.moveTo(x + size * 0.5, y + size * 0.25);
  ctx.lineTo(x + size * 0.5, y + size * 0.72);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x + size * 0.5, y + size * 0.24, size * 0.18, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawCrown(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
  ctx.save();
  ctx.fillStyle = "#F0C45C";
  ctx.strokeStyle = "#B9854C";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(x, y + height);
  ctx.lineTo(x + width * 0.12, y + height * 0.32);
  ctx.lineTo(x + width * 0.34, y + height * 0.62);
  ctx.lineTo(x + width * 0.5, y);
  ctx.lineTo(x + width * 0.66, y + height * 0.62);
  ctx.lineTo(x + width * 0.88, y + height * 0.32);
  ctx.lineTo(x + width, y + height);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function matchKey(round: string, slot: number) {
  return `${round}:${slot}`;
}

function createMatchMap(bracket: ShareBracket) {
  const matches = new Map<string, ShareMatch>();
  for (const round of bracket.rounds) {
    for (const match of round.matches) {
      matches.set(matchKey(match.round, match.slot), match);
    }
  }

  return matches;
}

function championFromFinal(match: ShareMatch | null) {
  if (!match?.resultVisible || !match.winnerEntryId) {
    return null;
  }

  return (
    [match.left, match.right].find(
      (participant) => participant?.entryId === match.winnerEntryId,
    ) ?? null
  );
}

function currentStageLabel(bracket: ShareBracket, matches: Map<string, ShareMatch>) {
  const finalMatch = matches.get(matchKey("final", 1)) ?? null;
  if (championFromFinal(finalMatch)) {
    return "冠军已决出";
  }

  const roundOrder = [
    ["final", "决赛阶段"],
    ["third_place", "决赛阶段"],
    ["semifinal", "半决赛"],
    ["quarterfinal", "8 强"],
    ["round_of_16", "16 强"],
  ] as const;

  for (const [round, label] of roundOrder) {
    const roundMatches = [...matches.values()].filter((match) => match.round === round);
    if (roundMatches.some((match) => match.contest?.status === "voting")) {
      return label;
    }
    if (
      roundMatches.length > 0 &&
      roundMatches.some(
        (match) => match.contest?.status === "closed" || match.contest?.status === "published",
      )
    ) {
      return `${label}结果`;
    }
  }

  return bracket.hasVotingMatch ? "正赛进行中" : "正赛赛程";
}

function collectImageUrls(bracket: ShareBracket) {
  const urls = new Set<string>();
  for (const round of bracket.rounds) {
    for (const match of round.matches) {
      for (const participant of [match.left, match.right]) {
        const url = publicVoteImageUrl(participant?.imagePath);
        if (url) {
          urls.add(url);
        }
      }
    }
  }
  urls.add(imageSource(logo));
  return [...urls];
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

async function loadImages(urls: string[]) {
  const entries = await Promise.all(
    urls.map(async (url) => [url, await loadImage(url)] as const),
  );
  return new Map(entries);
}

function drawConnector(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
) {
  const midX = (fromX + toX) / 2;
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(midX, fromY);
  ctx.lineTo(midX, toY);
  ctx.lineTo(toX, toY);
  ctx.stroke();
}

function drawMergeConnector(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  firstY: number,
  secondY: number,
  toX: number,
  targetY: number,
) {
  const midX = (fromX + toX) / 2;
  ctx.beginPath();
  ctx.moveTo(fromX, firstY);
  ctx.lineTo(midX, firstY);
  ctx.moveTo(fromX, secondY);
  ctx.lineTo(midX, secondY);
  ctx.moveTo(midX, firstY);
  ctx.lineTo(midX, secondY);
  ctx.moveTo(midX, targetY);
  ctx.lineTo(toX, targetY);
  ctx.stroke();
}

function drawParticipant(
  ctx: CanvasRenderingContext2D,
  participant: ShareParticipant | null,
  rect: Rect,
  resultVisible: boolean,
  images: Map<string, HTMLImageElement | null>,
) {
  if (!participant) {
    fillRoundedRect(ctx, rect, 18, "#FFFFFFAA", "#EED8AA", 3);
    ctx.fillStyle = "#8A6A45";
    ctx.font = "24px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("待定", rect.x + rect.width / 2, rect.y + 30);
    return;
  }

  const isWinner = participant.isWinner && resultVisible;
  fillRoundedRect(
    ctx,
    rect,
    18,
    isWinner ? "#ECF8E9" : "#FFFFFFD9",
    isWinner ? "#65A96E" : "#EED8AA",
    isWinner ? 5 : 3,
  );

  if (isWinner) {
    ctx.fillStyle = "#3C8B4F";
    roundedRect(ctx, rect.x + 4, rect.y + 6, 8, rect.height - 12, 5);
    ctx.fill();
  }

  const imageRect = {
    x: rect.x + 18,
    y: rect.y + 8,
    width: 56,
    height: rect.height - 16,
  };
  fillRoundedRect(ctx, imageRect, 14, "#F1E4C8", undefined);

  const imageUrl = publicVoteImageUrl(participant.imagePath);
  const image = imageUrl ? images.get(imageUrl) : null;
  if (image) {
    drawImageCover(ctx, image, imageRect.x, imageRect.y, imageRect.width, imageRect.height, 14);
  } else {
    drawPlaceholderIcon(ctx, imageRect.x + 10, imageRect.y + 8, 36);
  }

  const textX = rect.x + 88;
  const scoreWidth = resultVisible && participant.score !== null ? 42 : 0;
  ctx.textAlign = "left";
  ctx.fillStyle = "#4A2B1B";
  ctx.font = "700 22px sans-serif";
  drawTextLines(ctx, participant.name, textX, rect.y + 25, rect.width - 104 - scoreWidth, 24, 2);

  if (participant.seedLabel) {
    ctx.fillStyle = "#8A6A45";
    ctx.font = "18px sans-serif";
    drawTextLines(ctx, participant.seedLabel, textX, rect.y + 73, rect.width - 104, 22, 1);
  }

  if (resultVisible && participant.score !== null) {
    ctx.fillStyle = isWinner ? "#2F7A42" : "#5C321E";
    ctx.font = "700 26px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(String(participant.score), rect.x + rect.width - 18, rect.y + 38);
  }
}

function drawMatch(
  ctx: CanvasRenderingContext2D,
  match: ShareMatch | null,
  round: string,
  slot: number,
  rect: Rect,
  images: Map<string, HTMLImageElement | null>,
  center = false,
) {
  fillRoundedRect(
    ctx,
    rect,
    24,
    center ? "#F1FAEF" : "#FFFCF4",
    center ? "#74B87A" : "#EED8AA",
    3,
  );

  ctx.textAlign = "left";
  ctx.fillStyle = "#8A6A45";
  ctx.font = "700 18px sans-serif";
  ctx.fillText(`${ROUND_LABEL[round] ?? "正赛"} · 第 ${slot} 场`, rect.x + 18, rect.y + 28);

  if (match?.contest) {
    const statusText = STATUS_LABEL[match.contest.status] ?? match.contest.status;
    ctx.textAlign = "right";
    ctx.fillStyle = match.contest.status === "voting" ? "#B55335" : "#8A6A45";
    ctx.font = "700 18px sans-serif";
    ctx.fillText(statusText, rect.x + rect.width - 18, rect.y + 28);
  }

  const resultVisible = match?.resultVisible ?? false;
  drawParticipant(
    ctx,
    match?.left ?? null,
    {
      x: rect.x + 14,
      y: rect.y + 44,
      width: rect.width - 28,
      height: PARTICIPANT_HEIGHT,
    },
    resultVisible,
    images,
  );
  drawParticipant(
    ctx,
    match?.right ?? null,
    {
      x: rect.x + 14,
      y: rect.y + 94,
      width: rect.width - 28,
      height: PARTICIPANT_HEIGHT,
    },
    resultVisible,
    images,
  );
}

function drawChampionCard(
  ctx: CanvasRenderingContext2D,
  champion: ShareParticipant,
  tournamentName: string,
  rect: Rect,
  images: Map<string, HTMLImageElement | null>,
) {
  fillRoundedRect(ctx, rect, 28, "#FFF4D8", "#F0C45C", 5);
  drawCrown(ctx, rect.x + rect.width / 2 - 46, rect.y + 18, 92, 58);

  const imageX = rect.x + rect.width / 2 - 62;
  const imageY = rect.y + 70;
  fillRoundedRect(
    ctx,
    { x: imageX, y: imageY, width: 124, height: 124 },
    24,
    "#FFFFFF",
    "#F0C45C",
    6,
  );

  const imageUrl = publicVoteImageUrl(champion.imagePath);
  const image = imageUrl ? images.get(imageUrl) : null;
  if (image) {
    drawImageCover(ctx, image, imageX + 4, imageY + 4, 116, 116, 20);
  } else {
    drawPlaceholderIcon(ctx, imageX + 36, imageY + 34, 54);
  }

  ctx.textAlign = "center";
  ctx.fillStyle = "#4A2B1B";
  ctx.font = "700 32px sans-serif";
  drawTextLines(ctx, champion.name, rect.x + rect.width / 2, rect.y + 228, rect.width - 36, 36, 2);
  ctx.fillStyle = "#B9854C";
  ctx.font = "700 23px sans-serif";
  drawTextLines(
    ctx,
    `${tournamentName}冠军`,
    rect.x + rect.width / 2,
    rect.y + 302,
    rect.width - 36,
    28,
    2,
  );
}

function drawWatermark(
  ctx: CanvasRenderingContext2D,
  bracket: ShareBracket,
  stageLabel: string,
  images: Map<string, HTMLImageElement | null>,
) {
  const logoUrl = imageSource(logo);
  const logoImage = images.get(logoUrl);
  const box = { x: 1510, y: 1252, width: 790, height: 92 };
  fillRoundedRect(ctx, box, 28, "#FFF8E8E6", "#EED8AA", 3);

  if (logoImage) {
    drawImageCover(ctx, logoImage, box.x + 22, box.y + 16, 62, 62, 16);
  }

  ctx.textAlign = "left";
  ctx.fillStyle = "#5C321E";
  ctx.font = "700 25px sans-serif";
  drawTextLines(ctx, bracket.tournament.name, box.x + 106, box.y + 34, 450, 28, 1);
  ctx.fillStyle = "#8A5525";
  ctx.font = "700 21px sans-serif";
  ctx.fillText(`当前赛事阶段：${stageLabel}`, box.x + 106, box.y + 66);
  ctx.textAlign = "right";
  ctx.fillStyle = "#B9854C";
  ctx.font = "700 23px sans-serif";
  ctx.fillText("Butter Vote  @SiriNatsume", box.x + box.width - 24, box.y + 56);
}

function drawBracketImage(
  bracket: ShareBracket,
  images: Map<string, HTMLImageElement | null>,
) {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("当前浏览器不支持图片生成。");
  }

  const matches = createMatchMap(bracket);
  const stageLabel = currentStageLabel(bracket, matches);
  const finalMatch = matches.get(matchKey("final", 1)) ?? null;
  const champion = championFromFinal(finalMatch);

  ctx.fillStyle = "#FFF8E8";
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  ctx.fillStyle = "#FFF3D0";
  ctx.beginPath();
  ctx.ellipse(2050, 120, 480, 220, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#FFE4B8";
  ctx.beginPath();
  ctx.ellipse(220, 1220, 520, 260, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.textAlign = "left";
  ctx.fillStyle = "#5C321E";
  ctx.font = "700 48px sans-serif";
  drawTextLines(ctx, bracket.tournament.name, 80, 82, 1320, 56, 1);
  ctx.fillStyle = "#8A5525";
  ctx.font = "700 28px sans-serif";
  ctx.fillText(`正赛对阵 · ${stageLabel}`, 80, 130);

  ctx.strokeStyle = "#9A6A35";
  ctx.lineWidth = 8;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const columns = {
    left16: 80,
    left8: 410,
    leftSemi: 740,
    center: 1060,
    rightSemi: 1400,
    right8: 1730,
    right16: 2060,
  };
  const y = {
    round16: [230, 460, 690, 920],
    qf: [345, 805],
    semi: 575,
    champion: 210,
    final: champion ? 560 : 470,
    third: champion ? 790 : 720,
  };
  const centers = {
    round16: y.round16.map((value) => value + NODE_HEIGHT / 2),
    qf: y.qf.map((value) => value + NODE_HEIGHT / 2),
    semi: y.semi + NODE_HEIGHT / 2,
    final: y.final + NODE_HEIGHT / 2,
  };

  drawMergeConnector(
    ctx,
    columns.left16 + NODE_WIDTH,
    centers.round16[0],
    centers.round16[1],
    columns.left8,
    centers.qf[0],
  );
  drawMergeConnector(
    ctx,
    columns.left16 + NODE_WIDTH,
    centers.round16[2],
    centers.round16[3],
    columns.left8,
    centers.qf[1],
  );
  drawMergeConnector(
    ctx,
    columns.left8 + NODE_WIDTH,
    centers.qf[0],
    centers.qf[1],
    columns.leftSemi,
    centers.semi,
  );
  drawConnector(ctx, columns.leftSemi + NODE_WIDTH, centers.semi, columns.center, centers.final);
  drawConnector(ctx, columns.rightSemi, centers.semi, columns.center + CENTER_WIDTH, centers.final);
  drawMergeConnector(
    ctx,
    columns.right8,
    centers.qf[0],
    centers.qf[1],
    columns.rightSemi + NODE_WIDTH,
    centers.semi,
  );
  drawMergeConnector(
    ctx,
    columns.right16,
    centers.round16[0],
    centers.round16[1],
    columns.right8 + NODE_WIDTH,
    centers.qf[0],
  );
  drawMergeConnector(
    ctx,
    columns.right16,
    centers.round16[2],
    centers.round16[3],
    columns.right8 + NODE_WIDTH,
    centers.qf[1],
  );

  [1, 2, 3, 4].forEach((slot, index) => {
    drawMatch(
      ctx,
      matches.get(matchKey("round_of_16", slot)) ?? null,
      "round_of_16",
      slot,
      { x: columns.left16, y: y.round16[index], width: NODE_WIDTH, height: NODE_HEIGHT },
      images,
    );
  });
  [1, 2].forEach((slot, index) => {
    drawMatch(
      ctx,
      matches.get(matchKey("quarterfinal", slot)) ?? null,
      "quarterfinal",
      slot,
      { x: columns.left8, y: y.qf[index], width: NODE_WIDTH, height: NODE_HEIGHT },
      images,
    );
  });
  drawMatch(
    ctx,
    matches.get(matchKey("semifinal", 1)) ?? null,
    "semifinal",
    1,
    { x: columns.leftSemi, y: y.semi, width: NODE_WIDTH, height: NODE_HEIGHT },
    images,
  );
  if (champion) {
    drawChampionCard(
      ctx,
      champion,
      bracket.tournament.name,
      { x: columns.center, y: y.champion, width: CENTER_WIDTH, height: 340 },
      images,
    );
  }
  drawMatch(
    ctx,
    finalMatch,
    "final",
    1,
    { x: columns.center, y: y.final, width: CENTER_WIDTH, height: NODE_HEIGHT },
    images,
    true,
  );
  const thirdPlace = matches.get(matchKey("third_place", 1)) ?? null;
  if (thirdPlace) {
    drawMatch(
      ctx,
      thirdPlace,
      "third_place",
      1,
      { x: columns.center, y: y.third, width: CENTER_WIDTH, height: NODE_HEIGHT },
      images,
      true,
    );
  }
  drawMatch(
    ctx,
    matches.get(matchKey("semifinal", 2)) ?? null,
    "semifinal",
    2,
    { x: columns.rightSemi, y: y.semi, width: NODE_WIDTH, height: NODE_HEIGHT },
    images,
  );
  [3, 4].forEach((slot, index) => {
    drawMatch(
      ctx,
      matches.get(matchKey("quarterfinal", slot)) ?? null,
      "quarterfinal",
      slot,
      { x: columns.right8, y: y.qf[index], width: NODE_WIDTH, height: NODE_HEIGHT },
      images,
    );
  });
  [5, 6, 7, 8].forEach((slot, index) => {
    drawMatch(
      ctx,
      matches.get(matchKey("round_of_16", slot)) ?? null,
      "round_of_16",
      slot,
      { x: columns.right16, y: y.round16[index], width: NODE_WIDTH, height: NODE_HEIGHT },
      images,
    );
  });

  drawWatermark(ctx, bracket, stageLabel, images);
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("图片生成失败。"));
      }
    }, "image/png");
  });
}

function safeFilenamePart(value: string) {
  return (
    value
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "tournament"
  );
}

function downloadBlob(blob: Blob, tournamentName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `buttervote-${safeFilenamePart(tournamentName)}-bracket.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function copyBlob(blob: Blob) {
  if (!navigator.clipboard || !("ClipboardItem" in window)) {
    return false;
  }

  await navigator.clipboard.write([
    new ClipboardItem({
      "image/png": blob,
    }),
  ]);
  return true;
}

export function TournamentBracketShareButton({
  bracket,
}: {
  bracket: ShareBracket;
}) {
  const [isGenerating, setIsGenerating] = useState(false);

  async function handleShare() {
    setIsGenerating(true);
    try {
      const images = await loadImages(collectImageUrls(bracket));
      const canvas = drawBracketImage(bracket, images);
      const blob = await canvasToBlob(canvas);
      const copied = await copyBlob(blob).catch(() => false);

      if (copied) {
        toast.success("对阵图图片已复制，可以直接粘贴分享");
      } else {
        downloadBlob(blob, bracket.tournament.name);
        toast.success("浏览器不支持直接复制，已下载对阵图图片");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "生成分享图片失败");
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleShare}
      disabled={isGenerating}
    >
      {isGenerating ? (
        <Download className="size-4 animate-pulse" aria-hidden="true" />
      ) : (
        <Share2 className="size-4" aria-hidden="true" />
      )}
      {isGenerating ? "生成中" : "分享对阵图"}
    </Button>
  );
}
