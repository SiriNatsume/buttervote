declare module "*.wasm" {
  const wasmAsset: string | URL | WebAssembly.Module;
  export default wasmAsset;
}

declare module "@resvg/resvg-wasm/index_bg.wasm" {
  const wasmAsset: string | URL | WebAssembly.Module;
  export default wasmAsset;
}
