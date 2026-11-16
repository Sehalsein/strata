#!/usr/bin/env bash
# Builds the knowledge base (apps/docs) and deploys it to docs.strata.sehalsein.com.
# Cloudflare's Workers Builds runs this on every merge to main that touches the docs
# (see README.md); run it by hand the same way.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"

cd "$root"
bun install --frozen-lockfile

# Typecheck and build: the site, plus llms.txt and a .md copy of every guide.
(cd apps/docs && bun run build)

cd deploy/docs
npx wrangler deploy
