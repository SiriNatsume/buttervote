import assert from "node:assert/strict";
import test from "node:test";
import { canonicalFontCharacters } from "../lib/bracket-image/font-text.ts";

test("score/card order changes reuse the same complete glyph subset", () => {
  const common = "0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  assert.equal(canonicalFontCharacters(`候选甲 +1 分${common}`), canonicalFontCharacters(`+2 分 候选甲${common}`));
  assert.equal(canonicalFontCharacters("乙甲甲😀"), canonicalFontCharacters("😀甲乙"));
  assert.notEqual(canonicalFontCharacters("候选甲"), canonicalFontCharacters("候选乙"));
});
