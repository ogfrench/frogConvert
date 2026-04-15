// ---------------------------------------------------------------------------
// Lightweight History API router for /convert and /pdf paths
// ---------------------------------------------------------------------------

export interface RouteState {
  mode: 'converter' | 'pdf-editor';
}

export function parseURL(pathname = location.pathname): RouteState {
  const base = pathname.replace(/^\/+|\/+$/g, '').split('/')[0];
  return { mode: base === 'pdf' ? 'pdf-editor' : 'converter' };
}

export function buildPath(mode: string): string {
  return mode === 'pdf-editor' ? '/pdf' : '/convert';
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
