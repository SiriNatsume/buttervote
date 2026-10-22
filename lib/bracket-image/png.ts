import "server-only";

import { initWasm, Resvg, type ResvgRenderOptions } from "@resvg/resvg-wasm";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  BRACKET_EXPORT_FONT_FAMILY,
  loadBracketExportFontBuffers,
} from "@/lib/bracket-image/fonts";
import { serverArtifacts } from "@/lib/cache/server-artifacts";
import { artifactDigest } from "@/lib/cache/versioned-artifact-cache";

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
  const wasmModule = getCloudflareContext().env.RESVG_WASM;
  if (!wasmModule) throw new Error("The Worker entry point did not provide the compiled resvg module.");
  await initWasm(wasmModule);
}

async function ensureResvgInitialized() {
  // Production receives a precompiled module from the Worker entry point,
  // independent of Next.js's shared-chunk and route output layout.
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

// Call only after the route's current permission/version checks. The complete
// SVG (including visible scores, phase, images and styling) defines identity.
// Each owner has one private slot, so stepping through a session cannot grow R2
// by one object per card. Browser responses remain no-store for revocations.
export async function cachedSvgToPng(owner: string, svg: string) {
  const revision = await artifactDigest(svg);
  return serverArtifacts.getOrCreate("rendered-png-v1", owner, revision, () => svgToPng(svg));
}
