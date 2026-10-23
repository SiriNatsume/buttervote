import assert from "node:assert/strict";
import test from "node:test";
import { fetchExportAssetBytes } from "../lib/export-image/asset-fetch.ts";

test("export asset deadlines include a stalled response body after headers arrive", { timeout: 1000 }, async () => {
  const fetcher: typeof fetch = async (_input, init) => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1]));
      init!.signal!.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true });
    },
  }));
  await assert.rejects(fetchExportAssetBytes("https://assets.example/font.ttf", {
    fetcher, timeoutMs: 20, maxBytes: 1024,
  }), { name: "AbortError" });
});

test("assets exceeding the actual byte limit or returning an HTTP error cannot enter the cache", async () => {
  await assert.rejects(fetchExportAssetBytes("https://assets.example/image.jpg", {
    fetcher: async () => new Response(new Uint8Array(20)), maxBytes: 10,
  }), /invalid size/);
  await assert.rejects(fetchExportAssetBytes("https://assets.example/image.jpg", {
    fetcher: async () => new Response("unavailable", { status: 503 }), maxBytes: 1024,
  }), /503/);
});
