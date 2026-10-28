/** A WebAssembly file inlined by Vite as a base64 data URL. */
declare module '*.wasm?inline' {
  const dataUrl: string;
  export default dataUrl;
}

/** A file bundled by Vite and served next to the app; the import is its URL. */
declare module '*?url' {
  const url: string;
  export default url;
}
