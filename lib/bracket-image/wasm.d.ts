declare module "*.wasm" {
  const wasmModule: WebAssembly.Module;
  export default wasmModule;
}

// Supplied by worker.mjs before OpenNext establishes the request context.
interface CloudflareEnv {
  RESVG_WASM?: WebAssembly.Module;
}
