// Loads the vendored anitomy-ng WebAssembly parser (see src/vendor/anitomy/README.md).
// The module comes from the runtime: embedded in the compiled binary on Bun, bundled by
// wrangler on Workers. Set up on first use.
import * as bindings from "../vendor/anitomy/anitomy_ng_bg.js";
import type { Element } from "../vendor/anitomy/anitomy_ng";
import { runtime } from "#runtime";

let ready = false;

function init() {
  const instance = new WebAssembly.Instance(runtime.anitomyWasm(), { "./anitomy_ng_bg.js": bindings } as unknown as ConstructorParameters<typeof WebAssembly.Instance>[1]);
  bindings.__wbg_set_wasm(instance.exports);
  (instance.exports.__wbindgen_start as () => void)();
  ready = true;
}

export type AnitomyElement = Element;

export function anitomy(filename: string): AnitomyElement[] {
  if (!ready) init();
  return bindings.parse(filename);
}
