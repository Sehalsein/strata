# Deploying Strata to the Mac mini

The web app ships as a private Docker image at
`ghcr.io/sehalsein/strata-web`. GitHub Actions
(`.github/workflows/web-image.yml`) builds and pushes a multi-arch image
(`linux/amd64,linux/arm64`) on every push to `main` and on `v*` tags. The
Mac mini just pulls; no source checkout, no Bun, no build.

## One-time setup (Mac mini)

1. Confirm a Docker engine is installed. Docker Desktop, OrbStack, and
   Colima all work:
   ```sh
   docker compose version
   ```

2. Make a deploy directory and copy two files over from the dev Mac:
   ```sh
   ssh macmini "mkdir -p ~/strata"
   scp docker-compose.yml .env.example macmini:~/strata/
   ```

3. On the Mac mini, copy the example env and edit anything you want to
   change (port, Jellyfin upstream, pinned tag — all defaults are sane):
   ```sh
   ssh macmini
   cd ~/strata
   cp .env.example .env
   $EDITOR .env   # optional
   ```

4. Generate a GitHub Personal Access Token with the `read:packages` scope
   (https://github.com/settings/tokens — classic token) and log in:
   ```sh
   echo $GHCR_PAT | docker login ghcr.io -u sehalsein --password-stdin
   ```

5. Pull and start:
   ```sh
   docker compose pull
   docker compose up -d
   ```

   Browse to `http://<mac-mini-host>:8080`.

## Updating

```sh
ssh macmini
cd ~/strata
docker compose pull && docker compose up -d
```

`pull` fetches the newest `:latest` for the host's architecture; `up -d`
recreates the container in place. Image is small (~50 MB compressed); the
update is seconds.

## Rollback

GHA tags every build with `sha-<short>` (visible at
https://github.com/Sehalsein?tab=packages → strata-web → tags). Pin it in
`.env`:

```sh
echo "IMAGE_TAG=sha-abc1234" >> .env
docker compose up -d
```

No rebuild, no source tree — just a re-pull of the old digest.

## Changing the host port

The compose file maps `${STRATA_WEB_PORT:-8080}:80`. To change the published
port:

```sh
$EDITOR .env        # set STRATA_WEB_PORT=9090
docker compose up -d
```

Compose recreates only the port mapping; no pull or rebuild.

> The variable is **`STRATA_WEB_PORT`**, not `WEB_PORT`. `WEB_PORT` is the
> Vite dev-server port and is left untouched on the dev Mac.

## Pointing at a different Jellyfin

If Jellyfin doesn't live on the Mac mini, override:

```sh
echo "JELLYFIN_URL=http://192.168.2.162:8096" >> .env
docker compose up -d
```

If you want the Jellyfin container bundled in the compose file instead,
start it with the profile and point the proxy at the service name:

```sh
JELLYFIN_URL=http://jellyfin:8096 docker compose --profile jellyfin up -d
```

## Running from source locally (no registry, no GHA)

Build the production image from this checkout and run it through Docker
exactly as it'd run on the Mac mini:

```sh
docker compose -f docker-compose.dev.yml up --build
```

That tags the image as `strata-web:dev` and runs it as `strata-web-dev`
on `${STRATA_WEB_PORT:-8080}`. Useful for testing the prod build (nginx
config, cache headers, /jf proxy, service worker) before pushing.

For *fast* iteration on the SPA itself (HMR, source maps, etc.), keep
using `bun --cwd apps/web run dev` natively — the dev compose still
builds a fresh static bundle on every `--build`.

## Manual build from the dev Mac (no GHA)

Same image, locally built and pushed straight to GHCR:

```sh
docker login ghcr.io -u sehalsein
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --file apps/web/Dockerfile \
  --build-arg VITE_JELLYFIN_URL=/jf \
  --tag ghcr.io/sehalsein/strata-web:latest \
  --push \
  .
```

Then on the Mac mini: `docker compose pull && docker compose up -d`.
