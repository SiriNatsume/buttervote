import assert from "node:assert/strict";
import test from "node:test";
import { cacheVoteImageResponse } from "../lib/image/image-cache";

const origin = "https://storage.example.test";
const publicImage = `${origin}/storage/v1/object/public/vote-images/a.webp?v=123`;
const imageRequest = (url = publicImage) => `https://buttervote.test/_next/image?url=${encodeURIComponent(url)}&w=128&q=75`;

test("optimized public vote images receive a short shared-cache lifetime", async () => {
  const response = cacheVoteImageResponse(imageRequest(), new Response("image", {
    headers: { "Content-Type": "image/webp" },
  }), origin);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=60, s-maxage=60, must-revalidate");
  assert.equal(await response.text(), "image");
});

test("HTML, private responses, unrelated origins and image failures are never made public-cacheable", () => {
  for (const [url, response] of [
    ["https://buttervote.test/", new Response("personal HTML")],
    [imageRequest(), new Response("private", { headers: { "Cache-Control": "private, no-store" } })],
    [imageRequest(), new Response("cookie", { headers: { "Set-Cookie": "session=private" } })],
    [imageRequest(), new Response("error", { status: 500 })],
    [imageRequest(`${origin}/storage/v1/object/sign/vote-images/a.webp?token=private`), new Response("private image")],
    [imageRequest("https://other.example.test/image.webp"), new Response("unrelated")],
  ] as const) assert.equal(cacheVoteImageResponse(url, response, origin), response);
});

test("immutable build assets retain their original cache policy", () => {
  const response = new Response("immutable", { headers: { "Cache-Control": "public, max-age=31536000, immutable" } });
  assert.equal(cacheVoteImageResponse(imageRequest(), response, origin), response);
});
