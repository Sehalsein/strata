import { registerSW } from "virtual:pwa-register";
import { toast } from "sonner";

/**
 * Service-worker registration. The plugin emits a `virtual:pwa-register`
 * module at build time; we wrap it so an update arriving mid-session
 * surfaces as a sonner toast instead of silently swapping bundles. The
 * user keeps watching whatever's playing until they choose to reload.
 *
 * Skipped entirely in dev (`devOptions.enabled = false` in vite config)
 * and on browsers without service worker support (private modes,
 * embedded webviews).
 */
export function registerStrataServiceWorker(): void {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      toast("A new edition of Strata is ready.", {
        description: "Reload to pick it up.",
        duration: Number.POSITIVE_INFINITY,
        action: {
          label: "Reload",
          onClick: () => {
            // `updateSW(true)` activates the waiting SW and reloads.
            void updateSW(true);
          },
        },
      });
    },
    onOfflineReady() {
      toast.success("Strata is ready offline.", {
        description: "Posters and recently-viewed pages will keep working without a network.",
        duration: 4000,
      });
    },
    onRegisterError(error) {
      // Don't surface to the user — SW registration failures are usually
      // sandboxing (Firefox private, Safari pre-16.4) and the app still
      // works without offline support.
      console.warn("[strata] service worker registration failed", error);
    },
  });
}
