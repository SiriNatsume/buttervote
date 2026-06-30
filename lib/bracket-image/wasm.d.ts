declare module "*.wasm" {
  const wasmAsset: string | URL | WebAssembly.Module;
  export default wasmAsset;
}

declare module "*.wasm?module" {
  const wasmModule: WebAssembly.Module;
  export default wasmModule;
}

declare module "@resvg/resvg-wasm/index_bg.wasm" {
  const wasmAsset: string | URL | WebAssembly.Module;
  export default wasmAsset;
}

declare module "@resvg/resvg-wasm/index_bg.wasm?module" {
  const wasmModule: WebAssembly.Module;
  export default wasmModule;
}
