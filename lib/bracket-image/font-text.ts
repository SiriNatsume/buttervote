// Ordering does not affect glyph coverage. Canonicalizing the set prevents the
// same characters in a different score/card order from creating a new subset.
export function canonicalFontCharacters(value: string) {
  return Array.from(new Set(Array.from(value))).sort().join("");
}

// Load only the weights this image uses. The bracket uses 400–600, while the
// existing calling images use 700–950 (Noto Sans SC tops out at 900).
export function svgFontWeights(svg: string) {
  const weights = Array.from(svg.matchAll(/font-weight\s*=\s*["'](\d+)["']/g),
    (match) => Math.min(900, Math.max(100, Math.round(Number(match[1]) / 100) * 100)),
  );
  return [...new Set(weights.length > 0 ? weights : [700, 800, 900])].sort((a, b) => a - b);
}
