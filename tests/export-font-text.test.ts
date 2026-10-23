import assert from "node:assert/strict";
import test from "node:test";
import { canonicalFontCharacters, svgFontWeights } from "../lib/bracket-image/font-text.ts";

test("score/card order changes reuse the same complete glyph subset", () => {
  const common = "0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  assert.equal(canonicalFontCharacters(`候选甲 +1 分${common}`), canonicalFontCharacters(`+2 分 候选甲${common}`));
  assert.equal(canonicalFontCharacters("乙甲甲😀"), canonicalFontCharacters("😀甲乙"));
  assert.notEqual(canonicalFontCharacters("候选甲"), canonicalFontCharacters("候选乙"));
});

test("export font subsets include the lighter bracket weights without changing calling-image weights", () => {
  assert.deepEqual(svgFontWeights('<text font-weight="600"/><text font-weight="400"/><text font-weight="500"/><text font-weight="600"/>'), [400, 500, 600]);
  assert.deepEqual(svgFontWeights('<text font-weight="700"/><text font-weight="800"/><text font-weight="900"/><text font-weight="950"/>'), [700, 800, 900]);
  assert.deepEqual(svgFontWeights("<svg/>"), [700, 800, 900]);
});
