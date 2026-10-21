// Bun's `import path from "./x.wasm" with { type: "file" }` gives the embedded file's path.
declare module "*.wasm" {
  const path: string;
  export default path;
}
