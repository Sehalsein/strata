# Demo server

A Strata server with a library of public-domain films and TV episodes. Use it for App Store screenshots, App Review, or trying the apps without your own media.

## Quick start

From `apps/server`:

```sh
bun scripts/demo/fetch-media.ts                  # ~210 MB of 3-minute clips from archive.org
TMDB_API_KEY=… bun scripts/demo/serve.ts         # http://<this machine>:8460
```

Sign in as **Alex** / **demo-password**. The other accounts, Sam and Kids, use the same password.

## Options

| Script | Option | Default |
|---|---|---|
| `fetch-media.ts` | `--out` | `~/StrataDemo/media` |
| `serve.ts` | `--media` | `~/StrataDemo/media` |
| `serve.ts` | `--port` | `8460` |
| `serve.ts` | `--public` | Off. Runs it as the hosted demo: sign in as `demo` / `strata-demo`, viewer only (see [deploy/cloudflare-demo](../../../../deploy/cloudflare-demo/README.md)). |

## How it behaves

- Every catalog list (trending, new, popular, "More Like This") is limited to the demo library, so no current titles show up. Anime rails are empty.
- Its data lives in a temporary folder and starts fresh each run.

## The library

- **Films:** Night of the Living Dead, Nosferatu, The General, His Girl Friday, Sherlock Jr., Detour, Carnival of Souls.
- **Episodes:** The Beverly Hillbillies and Bonanza (season 1).

All are public domain in the US, as listed by the Internet Archive.
