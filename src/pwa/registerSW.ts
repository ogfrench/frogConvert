import { showToast } from "../components/Toast/Toast";

export interface PwaEnv {
  isDesktop: boolean;
  hasWindow: boolean;
  hasServiceWorker: boolean;
  protocol: string;
  userAgent: string;
}

export function shouldRegisterPwa(env: PwaEnv): boolean {
  if (env.isDesktop) return false;
  if (!env.hasWindow) return false;
  if (!env.hasServiceWorker) return false;
  if (env.protocol === "app:" || env.protocol === "file:") return false;
  if (env.userAgent.includes("Electron")) return false;
  return true;
}

function defaultEnv(): PwaEnv {
  return {
    isDesktop: Boolean(import.meta.env.VITE_IS_DESKTOP),
    hasWindow: typeof window !== "undefined",
    hasServiceWorker: typeof navigator !== "undefined" && "serviceWorker" in navigator,
    protocol: typeof location !== "undefined" ? location.protocol : "",
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
  };
}

export function registerPWA(env: PwaEnv = defaultEnv()): void {
  if (!shouldRegisterPwa(env)) return;

  // @vite-ignore: the `virtual:pwa-register` module is provided by
  // vite-plugin-pwa, which is gated behind `!isDesktopBuild` in vite.config.js.
  // Without the magic comment, Rollup tries to statically resolve this dynamic
  // import during the desktop build and fails. The runtime guard above
  // (`shouldRegisterPwa` returns false on Electron) ensures we never actually
  // execute this import in a desktop bundle.
  void import(/* @vite-ignore */ "virtual:pwa-register").then(({ registerSW }) => {
    try {
      const updateSW = registerSW({
        onNeedRefresh() {
          showUpdateAvailableNotice(() => {
            void Promise.resolve(updateSW(true)).catch((e) => {
              console.warn("[pwa] updateSW(true) failed:", e);
            });
          });
        },
        onOfflineReady() {
          showToast("Offline-ready: WASMs will cache as you use them");
        },
        onRegisterError(error) {
          console.warn("[pwa] SW registration failed:", error);
        },
        onRegisteredSW(_swScriptUrl, registration) {
          if (registration?.scope && registration.scope !== `${location.origin}/`) {
            console.warn("[pwa] unexpected SW scope:", registration.scope);
          }
        },
      });
    } catch (err) {
      console.warn("[pwa] registerSW threw synchronously:", err);
    }
  }).catch((err) => {
    console.warn("[pwa] dynamic import of virtual:pwa-register failed:", err);
  });
}

function showUpdateAvailableNotice(onReload: () => void): void {
  if (document.getElementById("pwa-update-notice")) return;

  const notice = document.createElement("div");
  notice.id = "pwa-update-notice";
  notice.className = "convert-notice";
  notice.setAttribute("role", "status");
  notice.setAttribute("aria-live", "polite");
  notice.style.cssText = "position:fixed;bottom:1rem;right:1rem;left:1rem;max-width:28rem;margin-left:auto;z-index:9999;";

  notice.innerHTML = `
    <button type="button" class="close-btn close-btn-md convert-notice-dismiss"
            aria-label="Dismiss">&times;</button>
    <div class="convert-notice-body">
      <strong class="convert-notice-title">New version available</strong>
      <p class="convert-notice-text">Reload to get the latest converters and fixes.</p>
    </div>
    <button type="button" class="convert-notice-link" data-action="reload">
      Reload now &rarr;
    </button>
  `;

  notice.querySelector<HTMLButtonElement>("[data-action=reload]")?.addEventListener("click", () => {
    onReload();
  });
  notice.querySelector<HTMLButtonElement>(".convert-notice-dismiss")?.addEventListener("click", () => {
    notice.remove();
  });

  document.body.appendChild(notice);
}
