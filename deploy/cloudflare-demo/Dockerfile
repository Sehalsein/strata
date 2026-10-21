# The public Strata demo: the server from source, ffmpeg (to probe files), and 3-minute
# public-domain clips fetched from the Internet Archive at build time. Built from
# apps/server (see image_build_context in wrangler.jsonc).
FROM oven/bun:1.2.20-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY package.json ./
RUN bun install --production
COPY src ./src
COPY scripts/demo ./scripts/demo
RUN bun scripts/demo/fetch-media.ts --out /media
EXPOSE 8080
# TMDB_API_KEY comes from the Worker (a secret), passed in as an environment variable.
CMD ["bun", "scripts/demo/serve.ts", "--public", "--media", "/media", "--port", "8080"]
