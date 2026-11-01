#!/usr/bin/env bash
# Deploys the cloud server: typecheck, migrate Neon, deploy the Worker. Cloudflare's
# Workers Builds runs this on every merge to main (its deploy command); cloud.local.sh runs
# it by hand. Needs DATABASE_URL (Neon, pooled) and, outside Workers Builds, a signed-in
# wrangler.
#
# Migrating first means the previous Worker runs on the new schema until the new one is
# live, so migrations must stay compatible with it (src/db/migrations.ts).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [[ -n "${WORKERS_CI_BRANCH:-}" && "$WORKERS_CI_BRANCH" != main ]]; then
  echo "Only main deploys (this is $WORKERS_CI_BRANCH)." >&2
  exit 1
fi
[[ -n "${DATABASE_URL:-}" ]] || { echo "DATABASE_URL isn't set." >&2; exit 1; }

bun install --frozen-lockfile
bun install --frozen-lockfile --cwd apps/server/web
(cd apps/server && bun run typecheck)
# Built (and the Worker bundled) before migrating, so a broken build stops the deploy with
# Neon untouched.
wrangler() { (cd deploy/cloudflare && bun --bun "$ROOT/node_modules/.bin/wrangler" "$@"); }
(cd apps/server/web && bun run build)
wrangler deploy --dry-run

(cd apps/server && bun scripts/migrate.ts)

wrangler deploy --message "$(git rev-parse --short HEAD)${WORKERS_CI:+ from main}"
curl -fsS https://app.strata.sehalsein.com/api/info && echo
