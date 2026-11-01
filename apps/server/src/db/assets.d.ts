// Files embedded with `import x from "…" with { type: "file" }`: their path at run time.
declare module "*.data" {
  const path: string;
  export default path;
}
declare module "*.wasm" {
  const path: string;
  export default path;
}
