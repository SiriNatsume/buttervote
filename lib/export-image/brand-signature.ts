import "server-only";

import { BUTTER_VOTE_LOGO_DATA_URL } from "@/lib/export-image/butter-vote-logo-data";

export type BrandSignatureOptions = {
  x: number;
  y: number;
  width: number;
  logoDataUrl: string | null;
  handle?: string;
};

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function loadButterVoteLogoDataUrl() {
  return BUTTER_VOTE_LOGO_DATA_URL;
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
