// The bundled database's engine files, embedded in the compiled server: PGlite normally
// reads them from node_modules, which a single-file binary doesn't have. By path (the
// package doesn't export them), from the workspace's node_modules.
import pgliteWasm from "../../../../node_modules/@electric-sql/pglite/dist/pglite.wasm" with { type: "file" };
import initdbWasm from "../../../../node_modules/@electric-sql/pglite/dist/initdb.wasm" with { type: "file" };
import pgliteData from "../../../../node_modules/@electric-sql/pglite/dist/pglite.data" with { type: "file" };

export async function pgliteAssets() {
  const [pglite, initdb] = await Promise.all([
    WebAssembly.compile(await Bun.file(pgliteWasm).arrayBuffer()),
    WebAssembly.compile(await Bun.file(initdbWasm).arrayBuffer()),
  ]);
  return { pgliteWasmModule: pglite, initdbWasmModule: initdb, fsBundle: Bun.file(pgliteData) };
}
