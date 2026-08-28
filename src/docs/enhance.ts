import { renderMermaid } from './mermaid-renderer.ts';

/**
 * Best-effort enhancement of an already-visible document: syntax highlighting
 * and diagrams.
 *
 * Its own module rather than a function inside docs.ts, because docs.ts runs a
 * bootstrap on import (it reaches for `#doc-body`, `window.matchMedia` and the
 * theme toggle) and so cannot be imported by a test. The ordering this encodes
 * is the part that was actually broken, so it needs to be testable.
 *
 * Two rules live here:
 *
 * 1. Both steps measure rendered layout, so both must run AFTER the document is
 *    revealed. mermaid lays a diagram out from measured text, and an element
 *    still `display:none` measures as nothing - every <g> came out with
 *    transform="translate(undefined, NaN)". The old code got away with running
 *    before the reveal because mermaid.run() was fire-and-forget and happened
 *    to resolve after it; awaiting it made that accident load-bearing.
 *
 * 2. Both steps are behind dynamic imports, so a second navigation can overtake
 *    them. `isCurrent` lets a superseded call bail instead of enhancing the
 *    newer document - which matters more than it sounds, because mermaid stamps
 *    `data-processed` before awaiting the render and skips anything already
 *    stamped, so a stray run would leave the new document's diagrams
 *    permanently blank.
 *
 * Nothing here may throw: the document is on screen by this point, and failing
 * back to the error placeholder would replace a readable page with an error.
 */
export async function enhanceDoc(
  root: HTMLElement,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  if (!isCurrent()) return;

  // highlight.js is ~600 KB and, statically imported, sat in the docs entry
  // chunk that the service worker precaches. Fetched on demand instead, and
  // only when the document actually has code in it. Mermaid fences are
  // excluded because renderMermaid replaces those elements outright.
  const codeBlocks = root.querySelectorAll<HTMLElement>('pre code:not(.language-mermaid)');

  // Kicked off before awaiting hljs: the two downloads share nothing, and
  // awaiting them in series made a diagram wait on a highlighter it does not
  // need. Awaited at the end so its failures are still handled here.
  const diagrams = renderMermaid(root, isCurrent);

  if (codeBlocks.length) {
    try {
      const { default: hljs } = await import('highlight.js');
      // Re-checked: that import is a second chance to be superseded.
      if (isCurrent()) codeBlocks.forEach(el => hljs.highlightElement(el));
    } catch (err) {
      // Unhighlighted code is still readable; a stale chunk here also raises
      // vite:preloadError, which src/pwa/staleShell.ts acts on.
      console.warn('[docs] syntax highlighting unavailable:', err);
    }
  }
  await diagrams;
}
