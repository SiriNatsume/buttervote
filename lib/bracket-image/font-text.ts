// Ordering does not affect glyph coverage. Canonicalizing the set prevents the
// same characters in a different score/card order from creating a new subset.
export function canonicalFontCharacters(value: string) {
  return Array.from(new Set(Array.from(value))).sort().join("");
}
