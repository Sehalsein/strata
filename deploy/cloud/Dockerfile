# The cloud Strata server: stateless, one binary built with --mode cloud (see
# apps/server/src/mode.ts). Everything lasting lives in Postgres (Neon); the container
# can be replaced, restarted or run twice. Build from the repo root:
#
#   docker build -f deploy/cloud/Dockerfile -t strata-cloud .
#   docker run -p 8420:8420 \
#     -e DATABASE_URL='postgres://user:pass@ep-xxx.neon.tech/strata?sslmode=require' \
#     -e STRATA_SECRET_KEY="$(openssl rand -base64 32)" \
#     strata-cloud
#
# Keep STRATA_SECRET_KEY safe and the same across deploys: it encrypts the API keys
# stored in the database, and a different one can't read them.

FROM oven/bun:1.2.20 AS build
WORKDIR /src
COPY package.json bun.lock ./
COPY apps/server/package.json ./apps/server/
RUN bun install --frozen-lockfile
COPY apps/server ./apps/server
RUN cd apps/server/web && bun install --frozen-lockfile
RUN cd apps/server && bun scripts/build.ts --mode cloud && mv dist/strata-server-cloud-* /strata-server

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* \
  && useradd --system --uid 10001 strata
COPY --from=build /strata-server /usr/local/bin/strata-server
USER strata
ENV STRATA_PORT=8420 STRATA_HOST=0.0.0.0
EXPOSE 8420
HEALTHCHECK --interval=30s --timeout=5s CMD ["/usr/local/bin/strata-server", "--version"]
CMD ["/usr/local/bin/strata-server", "serve"]
