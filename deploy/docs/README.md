# Strata Docs on Cloudflare

The knowledge base ([apps/docs](../../apps/docs)) at [docs.strata.sehalsein.com](https://docs.strata.sehalsein.com), served as static files by the Worker `strata-docs`. There's no server code, and the guides need no secrets.

## How deploys work

Every merge to `main` that touches the docs deploys through Cloudflare's Workers Builds, which runs [`deploy.sh`](deploy.sh):

1. Installs dependencies.
2. Typechecks and builds the site, plus `llms.txt`, `llms-full.txt` and a `.md` copy of every guide. A broken build stops here and the live site stays as it was.
3. Deploys the Worker.

To deploy by hand:

```sh
bash deploy/docs/deploy.sh
```

### Workers Builds settings

Under Worker `strata-docs` › Settings › Builds:

| Setting | Value |
|---|---|
| Repository, branch | `Sehalsein/strata`, `main`; builds for other branches off |
| Root directory | `/` |
| Build command | (none) |
| Deploy command | `bash deploy/docs/deploy.sh` |
| Build watch paths | `apps/docs/**`, `deploy/docs/**`, `apps/landing/src/**`, `apps/server/web/src/index.css`, `apps/server/web/src/components/poster-wall.tsx`, `apps/server/web/src/lib/utils.ts`, `package.json`, `bun.lock` |
| Variables | `BUN_VERSION` = `1.2.20` |

The watch paths include the landing site's styles and the dashboard files the docs reuse, so a change to the shared look redeploys the docs too.
