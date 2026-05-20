# syntax=docker/dockerfile:1.7

# Build the SPA with Bun against the workspace at the repo root, then serve
# the static `dist/` output through nginx.
#
# Multi-arch note: the build stage is pinned to $BUILDPLATFORM so Bun runs
# natively on the runner architecture instead of under QEMU emulation —
# Bun + Alpine + QEMU is a known fragility and was producing empty
# `dist/` directories on arm64 cross-builds. The SPA output is platform-
# agnostic HTML/JS/CSS, so a single native build feeds both target arches.

FROM --platform=$BUILDPLATFORM oven/bun:1.2.20-alpine AS build
WORKDIR /repo

# Manifests first so the install layer caches across source-only edits.
COPY package.json bun.lock turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json

RUN bun install --frozen-lockfile

# Source after install so editing components doesn't bust the deps layer.
COPY apps/web apps/web

# Bake `/jf` as the API base so the prod bundle hits same-origin and the
# nginx reverse proxy can swap Jellyfin upstreams without a rebuild. The
# `npm_lifecycle_event` skip is so `turbo` boundaries don't kick in.
ARG VITE_JELLYFIN_URL=/jf
ENV VITE_JELLYFIN_URL=$VITE_JELLYFIN_URL
RUN bun --cwd apps/web run build


FROM nginx:1.27-alpine AS runtime

# Default Jellyfin upstream — overridden via env in compose. host.docker.internal
# resolves to the host on Docker Desktop (Mac/Windows) and on Linux when the
# `extra_hosts` mapping in docker-compose.yml is honored.
ENV JELLYFIN_URL=http://host.docker.internal:8096
# Limit envsubst to our one placeholder so nginx variables ($uri, $host, ...)
# in the template survive untouched.
ENV NGINX_ENVSUBST_FILTER=^JELLYFIN_URL$

# Drop the stock default.conf; ours replaces it via the templates pipeline.
RUN rm /etc/nginx/conf.d/default.conf

COPY apps/web/nginx/strata.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html

EXPOSE 80
