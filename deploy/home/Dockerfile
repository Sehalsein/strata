# The home Strata server in Docker: the same server as the Mac/Linux binaries (home build),
# with ffmpeg for local media folders. State lives in /data (a volume): the bundled
# database, the secret key, logs and caches. See docker-compose.yml.
FROM oven/bun:1.2.20 AS build
WORKDIR /src
COPY package.json bun.lock ./
COPY apps/server/package.json ./apps/server/
RUN bun install --frozen-lockfile
COPY apps/server ./apps/server
RUN cd apps/server/web && bun install --frozen-lockfile
RUN cd apps/server && bun scripts/build.ts --mode home && mv dist/strata-server-linux-* /strata-server

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates ffmpeg && rm -rf /var/lib/apt/lists/* \
  && useradd --system --uid 10001 --create-home strata && mkdir /data && chown strata /data
COPY --from=build /strata-server /usr/local/bin/strata-server
USER strata
ENV STRATA_DATA_DIR=/data STRATA_PORT=8420 STRATA_HOST=0.0.0.0
VOLUME /data
EXPOSE 8420
CMD ["/usr/local/bin/strata-server", "serve"]
