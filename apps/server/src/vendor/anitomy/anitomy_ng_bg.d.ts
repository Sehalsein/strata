// Types for the vendored wasm-bindgen glue (anitomy_ng_bg.js); only what anitomy.ts uses.
import type { Element, Options } from "./anitomy_ng";
export function parse(filename: string, options?: Options | null): Element[];
export function __wbg_set_wasm(exports: WebAssembly.Exports): void;
