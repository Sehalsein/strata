# The public Strata demo: the server from source, ffmpeg (to probe files), and 3-minute
# public-domain clips fetched from the Internet Archive at build time. Built from the repo
# root (image_build_context in wrangler.jsonc); Dockerfile.dockerignore keeps the context
# to what's copied below.
FROM oven/bun:1.2.20-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app
# Exactly the versions in the repo's lockfile.
COPY package.json bun.lock ./
COPY apps/server/package.json ./apps/server/
RUN bun install --frozen-lockfile --production
WORKDIR /app/apps/server
# The clips first, so changing the server doesn't fetch them again.
COPY apps/server/scripts/demo/fetch-media.ts ./scripts/demo/
RUN bun scripts/demo/fetch-media.ts --out /media
COPY apps/server/src ./src
COPY apps/server/scripts/demo ./scripts/demo
EXPOSE 8080
# TMDB_API_KEY comes from the Worker (a secret), passed in as an environment variable.
CMD ["bun", "scripts/demo/serve.ts", "--public", "--media", "/media", "--port", "8080"]
