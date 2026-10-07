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
          // Applied straight away rather than offered behind a prompt. A
          // prompt left returning users on the old shell until they clicked
          // it, and a shell broken badly enough (an unstyled page) could not
          // show the prompt legibly. The cost is accepted: a tab that is
          // mid-conversion when an update lands reloads and loses that work.
          void Promise.resolve(updateSW(true)).catch((e) => {
            console.warn("[pwa] updateSW(true) failed:", e);
          });
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

