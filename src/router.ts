// ---------------------------------------------------------------------------
// Lightweight History API router for /convert/* and /pdf/* paths
// ---------------------------------------------------------------------------

const CONVERT_CATEGORIES = ['image', 'audio', 'video', 'document', 'archive', 'data', 'font', 'code', 'other'];
const PDF_TOOLS = ['merge', 'split', 'organize'];

export interface RouteState {
  mode: 'converter' | 'pdf-editor';
  sub: string; // category name or pdf tool, empty string for defaults
}

/** Parse current URL pathname into a RouteState. */
export function parseURL(pathname = location.pathname): RouteState {
  const parts = pathname.replace(/^\/+|\/+$/g, '').split('/');
  const base = parts[0];
  const sub = parts[1] || '';

  if (base === 'pdf') {
    return { mode: 'pdf-editor', sub: PDF_TOOLS.includes(sub) ? sub : '' };
  }
  if (base === 'convert') {
    return { mode: 'converter', sub: CONVERT_CATEGORIES.includes(sub) ? sub : '' };
  }
  // Unknown path → default
  return { mode: 'converter', sub: '' };
}

/** Build a URL path from mode + sub-tab. */
export function buildPath(mode: string, sub = ''): string {
  const base = mode === 'pdf-editor' ? '/pdf' : '/convert';
  return sub ? `${base}/${sub}` : base;
}

/** Push a new URL via History API. Skips if already at the target path or in Electron. */
export function navigateTo(mode: string, sub = ''): void {
  if (location.protocol === 'app:') return; // Electron — skip URL manipulation
  const target = buildPath(mode, sub);
  if (location.pathname === target) return; // Already there — avoid duplicate entries
  history.pushState(null, '', target);
}

/** Set up popstate listener and normalize the initial URL. Returns the initial RouteState. */
export function initRouter(onRouteChange: (route: RouteState) => void): RouteState {
  const initial = parseURL();

  if (location.protocol !== 'app:') {
    // Normalize bare "/" or unknown paths to /convert
    const correctPath = buildPath(initial.mode, initial.sub);
    if (location.pathname !== correctPath) {
      history.replaceState(null, '', correctPath);
    }

    window.addEventListener('popstate', () => {
      onRouteChange(parseURL());
    });
  }

  return initial;
}
