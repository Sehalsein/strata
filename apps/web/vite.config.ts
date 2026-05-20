import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { resolve } from "node:path";

export default defineConfig(({ mode }) => {
  const env = {
    ...loadEnv(mode, resolve(__dirname, "../.."), ""),
    ...loadEnv(mode, __dirname, ""),
    ...process.env,
  };

  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        // Auto-update so a redeploy reaches every installed Strata client
        // on the next launch without the user having to do anything.
        registerType: "autoUpdate",
        // Inject our own registration shim (`src/pwa.ts`) so we can show a
        // toast when an update is ready instead of silently reloading mid-
        // playback. We still want the service worker file emitted, so we
        // tell the plugin which file is the registration source.
        injectRegister: false,
        strategies: "generateSW",
        includeAssets: [
          "favicon-32.png",
          "favicon-192.png",
          "favicon-512.png",
          "apple-touch-icon.png",
          "og-image.png",
        ],
        manifest: {
          name: "Strata",
          short_name: "Strata",
          description: "Strata — a quiet way to watch.",
          id: "/?source=pwa",
          start_url: "/?source=pwa",
          scope: "/",
          lang: "en",
          dir: "ltr",
          orientation: "any",
          display: "standalone",
          display_override: ["window-controls-overlay", "standalone", "minimal-ui"],
          background_color: "#0C0A08",
          theme_color: "#0C0A08",
          categories: ["entertainment", "video", "lifestyle"],
          icons: [
            { src: "/favicon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "/favicon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            // Same artwork tagged maskable so adaptive-icon launchers (Android,
            // Chrome OS) crop into a safe zone instead of letterboxing.
            { src: "/favicon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
            { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png", purpose: "any" },
          ],
          shortcuts: [
            {
              name: "Search",
              short_name: "Search",
              description: "Search the library",
              url: "/search?source=pwa",
              icons: [{ src: "/favicon-192.png", sizes: "192x192" }],
            },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,svg,png,woff,woff2,ico,webmanifest}"],
          // Source-map files would inflate the precache by ~40 % and aren't
          // useful offline.
          globIgnores: ["**/*.map"],
          navigateFallback: "/index.html",
          // Detail pages on deep links should fall back to index for SPA
          // routing — but skip Jellyfin proxy requests so they hit network.
          navigateFallbackDenylist: [/^\/jf\//, /^\/api\//],
          cleanupOutdatedCaches: true,
          // 5 MB is plenty for a precache of CSS + JS chunks; the SDK +
          // hls.js bundle weighs ~1.2 MB pre-gzip.
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          runtimeCaching: [
            {
              // Cache Jellyfin item / backdrop / poster images for a week —
              // they are content-addressed via image tags so the URL only
              // changes when the asset itself does.
              urlPattern: ({ url }) => /\/Items\/[^/]+\/Images\//.test(url.pathname),
              handler: "CacheFirst",
              options: {
                cacheName: "strata-jellyfin-images",
                expiration: {
                  maxEntries: 400,
                  maxAgeSeconds: 60 * 60 * 24 * 7,
                },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              // Editorial font/static SVGs from the public folder, opportunistic.
              urlPattern: ({ url }) =>
                url.pathname.startsWith("/og-") ||
                url.pathname.endsWith(".woff2") ||
                url.pathname.endsWith(".woff"),
              handler: "StaleWhileRevalidate",
              options: { cacheName: "strata-static-assets" },
            },
            {
              // App-shell JSON catalogue requests via the dev proxy. Use
              // SWR so the UI feels instant offline while we revalidate.
              urlPattern: ({ url }) => url.pathname.startsWith("/jf/Users/"),
              handler: "NetworkFirst",
              options: {
                cacheName: "strata-jellyfin-api",
                networkTimeoutSeconds: 4,
                expiration: { maxEntries: 60, maxAgeSeconds: 60 * 30 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
        // Only enable the SW in production builds. `vite dev` will keep
        // serving fresh modules without a cache layer in the way.
        devOptions: { enabled: false },
      }),
    ],
    resolve: {
      alias: {
        "@": resolve(__dirname, "./src"),
      },
    },
    server: {
      host: true,
      allowedHosts: true,
      port: Number.parseInt(env.WEB_PORT ?? "5173", 10),
      proxy: {
        "/jf": {
          target: env.VITE_JELLYFIN_TARGET ?? "http://localhost:8096",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/jf/, ""),
        },
      },
    },
    preview: {
      host: true,
      allowedHosts: true,
      port: Number.parseInt(env.WEB_PORT ?? "5173", 10),
    },
    build: {
      outDir: "dist",
      sourcemap: true,
    },
  };
});
