import "server-only";

import { initWasm, Resvg, type ResvgRenderOptions } from "@resvg/resvg-wasm";
import {
  BRACKET_EXPORT_FONT_FAMILY,
  loadBracketExportFontBuffers,
} from "@/lib/bracket-image/fonts";

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

  const fontBuffers = await loadBracketExportFontBuffers(svg);
  if (fontBuffers.length === 0 && process.env.NODE_ENV === "production") {
    throw new Error(
      "Bracket export font could not be loaded; refusing to render without an explicit font.",
    );
  }

  const font: NonNullable<ResvgRenderOptions["font"]> =
    fontBuffers.length > 0
      ? {
          fontBuffers,
          defaultFontFamily: BRACKET_EXPORT_FONT_FAMILY,
          sansSerifFamily: BRACKET_EXPORT_FONT_FAMILY,
        }
      : {
          loadSystemFonts: true,
          defaultFontFamily: "Microsoft YaHei",
          sansSerifFamily: "Microsoft YaHei",
        };

  const renderer = new Resvg(svg, {
    fitTo: { mode: "original" },
    font,
    textRendering: 2,
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
