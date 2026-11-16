#!/usr/bin/env bash
# Builds the knowledge base (apps/docs) and deploys it to docs.strata.sehalsein.com.
# Cloudflare's Workers Builds runs this on every merge to main that touches the docs
# (see README.md); run it by hand the same way.
set -euo pipefail

# Only main reaches the live site, as for the server (deploy/cloudflare/deploy.sh). Checked
# before anything from the branch runs.
if [[ -n "${WORKERS_CI_BRANCH:-}" && "$WORKERS_CI_BRANCH" != main ]]; then
  echo "Only main deploys (this is $WORKERS_CI_BRANCH)." >&2
  exit 1
fi
root="$(cd "$(dirname "$0")/../.." && pwd)"

cd "$root"
bun install --frozen-lockfile

# Typecheck and build: the site, plus llms.txt and a .md copy of every guide.
(cd apps/docs && bun run build)

cd deploy/docs
npx wrangler deploy
