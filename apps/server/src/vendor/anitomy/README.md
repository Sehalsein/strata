Vendored from [anitomy-ng](https://github.com/tylergibbs2/anitomy-ng) 1.0.10 (npm), the
`bundler` WebAssembly build, under the MIT licence in `LICENSE`. Unmodified.

It's vendored rather than installed because the package's Node build reads its `.wasm`
from disk next to itself, which doesn't exist inside the compiled server binary.
`../../media/anime.ts` embeds the `.wasm` with Bun's file import and instantiates it.
