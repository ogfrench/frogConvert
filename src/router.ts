// ---------------------------------------------------------------------------
// Lightweight History API router for /convert, /pdf and /compress paths
// ---------------------------------------------------------------------------

export type AppMode = 'converter' | 'pdf-editor' | 'compress';

export interface RouteState {
  mode: AppMode;
}

/** Single source of truth for mode ↔ path. Add a mode here and both
 *  directions follow; nothing else in the router needs touching. */
const MODE_PATHS: Record<AppMode, string> = {
  converter: '/convert',
  'pdf-editor': '/pdf',
  compress: '/compress',
};

/** Derived, not hand-written: a second literal map would be one more place to
 *  forget, which is exactly what the claim above is supposed to rule out. */
const PATH_MODES: Record<string, AppMode> = Object.fromEntries(
  (Object.entries(MODE_PATHS) as [AppMode, string][])
    .map(([mode, path]) => [path.replace(/^\//, ''), mode]),
);

export function parseURL(pathname = location.pathname): RouteState {
  const base = pathname.replace(/^\/+|\/+$/g, '').split('/')[0];
  return { mode: PATH_MODES[base] ?? 'converter' };
}

export function buildPath(mode: string): string {
  return MODE_PATHS[mode as AppMode] ?? MODE_PATHS.converter;
}

/** Push a new URL via History API. Skips if already at the target path or in Electron. */
export function navigateTo(mode: string): void {
  if (location.protocol === 'app:') return;
  const target = buildPath(mode);
  if (location.pathname === target) return;
  history.pushState(null, '', target);
}

/** Set up popstate listener and normalize the initial URL. Returns the initial RouteState. */
export function initRouter(onRouteChange: (route: RouteState) => void): RouteState {
  const initial = parseURL();

  if (location.protocol !== 'app:') {
    const correctPath = buildPath(initial.mode);
    if (location.pathname !== correctPath) {
      history.replaceState(null, '', correctPath);
    }
    window.addEventListener('popstate', () => onRouteChange(parseURL()));
  }

  return initial;
}
