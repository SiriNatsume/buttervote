import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { getVoteImageSources } from "../lib/image/responsive-image";

const origin = "https://images.example.test";
const previous = process.env.NEXT_PUBLIC_SUPABASE_URL;
before(() => { process.env.NEXT_PUBLIC_SUPABASE_URL = origin; });
after(() => {
  if (previous === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = previous;
});

test("thumbnail requests preserve original paths and cache-busting versions", () => {
  const src = `${origin}/storage/v1/object/public/vote-images/candidates/example/image.jpg?v=123`;
  const result = getVoteImageSources(src, 128);
  const optimized = new URL(result.src, "https://buttervote.test");
  assert.equal(optimized.searchParams.get("url"), src);
  assert.equal(optimized.searchParams.get("w"), "128");
  assert.ok(result.srcSet);
  for (const variant of result.srcSet.split(", ")) {
    const [url, descriptor] = variant.split(" ");
    const width = Number.parseInt(descriptor, 10);
    assert.ok(width <= 128);
    assert.equal(new URL(url, "https://buttervote.test").searchParams.get("w"), String(width));
  }
});

test("only the configured public vote-image bucket is eligible for optimization", () => {
  for (const src of [
    "https://other.example.test/storage/v1/object/public/vote-images/a.webp",
    `${origin}/storage/v1/object/sign/vote-images/a.webp?token=private`,
    `${origin}/storage/v1/object/public/private-assets/a.webp`,
    "/img/girls/homepage-welcome.webp",
    "blob:https://buttervote.test/preview",
    "data:image/webp;base64,preview",
  ]) assert.deepEqual(getVoteImageSources(src), { src });
});

test("original image URLs remain usable without a configured storage origin", () => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  const src = `${origin}/storage/v1/object/public/vote-images/a.webp`;
  assert.deepEqual(getVoteImageSources(src), { src });
  process.env.NEXT_PUBLIC_SUPABASE_URL = origin;
});
