import { isDark } from './theme.ts';

type MermaidApi = (typeof import('mermaid'))['default'];

// mermaid is ~1.4 MB of the docs bundle on its own. Statically imported it sat
// in the docs entry chunk, which the service worker precaches - so every
// visitor paid for it on install, and most documents contain no diagram at all.
// Loaded on demand instead, and only once a document is known to have one.
let mermaidPromise: Promise<MermaidApi> | null = null;

function loadMermaid(): Promise<MermaidApi> {
  // Not a bare `??=`: that memoizes a rejection too, so one failed fetch (a
  // flaky connection, a chunk 404ing mid-deploy) would disable diagrams for the
  // rest of the page's life. Forget a failure so the next document, or the next
  // theme toggle, retries.
  mermaidPromise ??= import('mermaid')
    .then(m => m.default)
    .catch((err) => { mermaidPromise = null; throw err; });
  return mermaidPromise;
}

// Only re-initialize mermaid when the theme actually changes.
let mermaidTheme: string | null = null;

function ensureMermaid(mermaid: MermaidApi) {
  const theme = isDark() ? 'dark' : 'default';
  if (mermaidTheme === theme) return;
  mermaidTheme = theme;
  const darkVars = { edgeLabelBackground: '#4a4a5a', labelTextColor: '#e2e8f0' };
  mermaid.initialize({
    startOnLoad: false,
    theme,
    themeVariables: theme === 'dark' ? darkVars : {},
  });
}

// Renders are serialised, and a job superseded before it starts is dropped.
//
// mermaid.run() stamps a node with data-processed and *then* awaits the real
// render, writing innerHTML when that resolves - and it skips any node already
// stamped. Two overlapping runs over the same nodes therefore race: a theme
// toggle mid-render resets the nodes and starts a second run, and the first
// run's pending write lands after it, painting the old theme's SVG over the
// new one. Awaiting a dynamic import inside these functions widened that
// window from a single task to a whole network fetch, so the ordering is made
// explicit rather than left to luck.
let queue: Promise<void> = Promise.resolve();
let latestJob = 0;

function schedule(job: (mermaid: MermaidApi) => Promise<void>): Promise<void> {
  const token = ++latestJob;
  queue = queue.then(async () => {
    // A newer job was queued while this one waited; its work supersedes ours.
    if (token !== latestJob) return;
    const mermaid = await loadMermaid();
    ensureMermaid(mermaid);
    await job(mermaid);
  }).catch((err) => {
    // A failed diagram must not take the page down, and must not wedge the
    // queue for every later render. The source stays visible as plain text; a
    // stale chunk here also raises vite:preloadError, which
    // src/pwa/staleShell.ts acts on.
    console.warn('[docs] mermaid rendering unavailable:', err);
  });
  return queue;
}

/**
 * Render every mermaid fence in a freshly parsed document.
 *
 * `isCurrent` guards a superseded document: loadDoc awaits a dynamic import
 * before reaching here, so a second navigation can land in between. Rendering
 * then would stamp the *new* document's nodes as processed while they are
 * still hidden, and mermaid skips anything already stamped - so the new
 * document's diagrams would never draw at all.
 */
export async function renderMermaid(
  docBody: HTMLElement,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  docBody.querySelectorAll('code.language-mermaid').forEach(code => {
    const src = code.textContent ?? '';
    const div = document.createElement('div');
    div.className = 'mermaid';
    div.textContent = src;
    div.dataset.mermaidSrc = src;
    code.closest('pre')?.replaceWith(div);
  });

  const nodes = [...docBody.querySelectorAll('.mermaid')] as HTMLElement[];
  // The early return is the point of the whole arrangement: a document with no
  // diagram must not fetch the renderer.
  if (!nodes.length) return;

  await schedule(async (mermaid) => {
    if (!isCurrent()) return;
    await mermaid.run({ nodes });
  });
}

/** Re-run the diagrams already on the page, after a theme change. */
export async function rerenderMermaid(): Promise<void> {
  const nodes = [...document.querySelectorAll('#doc-body .mermaid')] as HTMLElement[];
  if (!nodes.length) return;

  await schedule(async (mermaid) => {
    nodes.forEach(el => {
      if (el.dataset.mermaidSrc) {
        el.removeAttribute('data-processed');
        el.textContent = el.dataset.mermaidSrc;
      }
    });
    await mermaid.run({ nodes });
  });
}
