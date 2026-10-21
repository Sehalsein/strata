// Loads the vendored anitomy-ng WebAssembly parser. The .wasm is embedded with a file
// import so it ships inside the compiled binary (see src/vendor/anitomy/README.md).
import wasmPath from "../vendor/anitomy/anitomy_ng_bg.wasm" with { type: "file" };
import * as bindings from "../vendor/anitomy/anitomy_ng_bg.js";
import type { Element } from "../vendor/anitomy/anitomy_ng";

const module = new WebAssembly.Module(await Bun.file(wasmPath).arrayBuffer());
const instance = new WebAssembly.Instance(module, { "./anitomy_ng_bg.js": bindings } as unknown as ConstructorParameters<typeof WebAssembly.Instance>[1]);
bindings.__wbg_set_wasm(instance.exports);
(instance.exports.__wbindgen_start as () => void)();

export type AnitomyElement = Element;

export function anitomy(filename: string): AnitomyElement[] {
  return bindings.parse(filename);
}
