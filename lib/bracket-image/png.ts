import "server-only";

import { initWasm, Resvg } from "@resvg/resvg-wasm";
import wasmAsset from "@resvg/resvg-wasm/index_bg.wasm";

let initPromise: Promise<void> | null = null;

function wasmInput() {
  if (typeof wasmAsset === "string") {
    if (wasmAsset.startsWith("data:")) {
      return fetch(wasmAsset);
    }

    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    return fetch(new URL(wasmAsset, baseUrl));
  }

  return wasmAsset;
}

async function ensureResvgInitialized() {
  initPromise ??= initWasm(wasmInput());
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
