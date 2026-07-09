import "server-only";

import { initWasm, Resvg, type ResvgRenderOptions } from "@resvg/resvg-wasm";
import {
  BRACKET_EXPORT_FONT_FAMILY,
  loadBracketExportFontBuffers,
} from "@/lib/bracket-image/fonts";

let initPromise: Promise<void> | null = null;

async function initWasmFromNodeFile() {
  const [{ readFile }, path] = await Promise.all([
    import("node:fs/promises"),
    import("node:path"),
  ]);
  const wasm = await readFile(
    path.join(
      process.cwd(),
      "node_modules",
      "@resvg",
      "resvg-wasm",
      "index_bg.wasm",
    ),
  );
  await initWasm(wasm);
}

async function initWasmFromBundledModule() {
  const { default: wasmModule } = await import(
    /* webpackIgnore: true */ "../../../../../../../lib/bracket-image/resvg.wasm?module"
  );
  await initWasm(wasmModule);
}

async function ensureResvgInitialized() {
  // This file is inlined into the API route bundle. Keep the production wasm
  // import relative to the emitted .next/server/app/... route file so Wrangler
  // can collect it as a compiled wasm module instead of a runtime-fetched asset.
  initPromise ??=
    process.env.NODE_ENV === "development"
      ? initWasmFromNodeFile()
      : initWasmFromBundledModule().catch((error) => {
          if (process.env.NODE_ENV === "production") {
            throw error;
          }
          return initWasmFromNodeFile();
        });
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
