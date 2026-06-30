import "server-only";

import logo from "@/img/网站logo.png";

export type BrandSignatureOptions = {
  x: number;
  y: number;
  width: number;
  logoDataUrl: string | null;
  handle?: string;
};

type StaticAsset = string | { src: string };

let logoPromise: Promise<string | null> | null = null;

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function assetSrc(asset: StaticAsset) {
  return typeof asset === "string" ? asset : asset.src;
}

function absoluteAssetUrl(src: string) {
  if (/^https?:\/\//i.test(src) || src.startsWith("data:")) {
    return src;
  }

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return new URL(src, baseUrl).toString();
}

async function fetchAssetDataUrl(src: string, fallbackContentType: string) {
  try {
    const response = await fetch(absoluteAssetUrl(src), { cache: "force-cache" });

    if (!response.ok) {
      return null;
    }

    const contentType =
      response.headers.get("content-type")?.split(";")[0] || fallbackContentType;
    const bytes = Buffer.from(await response.arrayBuffer());
    return `data:${contentType};base64,${bytes.toString("base64")}`;
  } catch (error) {
    console.error("Failed to load Butter Vote logo for image export.", error);
    return null;
  }
}

export async function loadButterVoteLogoDataUrl() {
  logoPromise ??= fetchAssetDataUrl(assetSrc(logo), "image/png");
  return logoPromise;
}

export function renderBrandSignatureSvg({
  x,
  y,
  width,
  logoDataUrl,
  handle = "@SiriNatsume",
}: BrandSignatureOptions) {
  const centerX = x + width / 2;
  const logoWidth = 220;
  const logoHeight = 44;
  const logoX = centerX - logoWidth / 2;
  const logoY = y + 18;
  const handleY = logoY + logoHeight + 30;

  return `
    <g class="brand-signature">
      <line x1="${x + 360}" y1="${y}" x2="${x + width - 360}" y2="${y}" stroke="#E8CF9B" stroke-width="2" stroke-linecap="round" opacity="0.75" />
      ${
        logoDataUrl
          ? `<image href="${escapeXml(logoDataUrl)}" x="${logoX}" y="${logoY}" width="${logoWidth}" height="${logoHeight}" preserveAspectRatio="xMidYMid meet" />`
          : `<text x="${centerX}" y="${logoY + 31}" text-anchor="middle" font-size="28" font-weight="800" fill="#B9854C">Butter Vote</text>`
      }
      <text x="${centerX}" y="${handleY}" text-anchor="middle" font-size="22" font-weight="700" fill="#B9854C">${escapeXml(handle)}</text>
    </g>
  `;
}