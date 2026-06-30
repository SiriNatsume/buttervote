import "server-only";

import { initWasm, Resvg } from "@resvg/resvg-wasm";

let initPromise: Promise<void> | null = null;

async function ensureResvgInitialized() {
  // This file is inlined into the API route bundle. Keep the wasm import relative
  // to the emitted .next/server/app/.../bracket-image/route.js file so Wrangler
  // can collect it as a compiled wasm module instead of a runtime-fetched asset.
  initPromise ??= import(
    /* webpackIgnore: true */ "../../../../../../../lib/bracket-image/resvg.wasm?module"
  ).then(({ default: wasmModule }) => initWasm(wasmModule));
  await initPromise;
}

export async function svgToPng(svg: string) {
  await ensureResvgInitialized();

  const renderer = new Resvg(svg, {
    fitTo: { mode: "original" },
    font: {
      loadSystemFonts: true,
      defaultFontFamily: "Microsoft YaHei",
      sansSerifFamily: "Microsoft YaHei",
    },
  });

  try {
    const image = renderer.render();

    try {
      return image.asPng();
    } finally {
      image.free();
    }
  } finally {
    renderer.free();
  }
}
