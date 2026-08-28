import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { initCustomCursor } from "../components/CustomCursor/CustomCursor.ts";
import { buildToc } from "./toc.ts";
import { initTheme } from "./theme.ts";
import { rerenderMermaid } from "./mermaid-renderer.ts";
import { enhanceDoc } from "./enhance.ts";
import { initSidebar, setActiveDoc, closeSidebar } from "./sidebar.ts";
import { initBuildInfo } from "./build-info.ts";
import { initStaleShellRecovery } from "../pwa/staleShell.ts";

// Docs precaches its own shell, so it strands the same way the app does.
// Also disarms the inline boot handler injected into this page's <head>.
initStaleShellRecovery();

interface NavDoc { file: string; icon: string; label: string; desc: string }

const NAV_DOCS = import.meta.env.VITE_NAV_DOCS as unknown as NavDoc[];

initCustomCursor();
// Async now; initTheme fires it and does not await, so swallow the rejection
// here rather than letting a theme toggle raise an unhandled one.
initTheme(() => { void rerenderMermaid(); });
initBuildInfo();
initSidebar(NAV_DOCS, loadDoc);

const placeholder = document.getElementById('doc-placeholder')!;
const docBody = document.getElementById('doc-body')!;

// Bumped on every navigation. loadDoc now awaits dynamic imports after it has
// mutated the shared #doc-body, so a second navigation can land mid-flight and
// the older call would otherwise keep enhancing the newer document.
let loadGeneration = 0;

async function loadDoc(filename: string) {
  const generation = ++loadGeneration;
  setActiveDoc(filename);

  placeholder.innerHTML = '<div class="loader-spinner"></div><span>Loading…</span>';
  placeholder.style.display = 'flex';
  docBody.style.display = 'none';

  try {
    const res = await fetch(`./${filename}`);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

    // Strip YAML frontmatter (---) or HTML comment frontmatter (<!-- docs-frontmatter ... -->)
    const md = (await res.text())
      .replace(/^---\r?\n[\s\S]*?\r?\n---/, '')
      .replace(/^<!--\s*docs-frontmatter\r?\n[\s\S]*?\r?\n-->/, '')
      .trim();
    docBody.innerHTML = DOMPurify.sanitize(await marked.parse(md));

    // Open external links in new tab
    docBody.querySelectorAll<HTMLAnchorElement>('a[href^="http://"], a[href^="https://"]').forEach(a => {
      a.target = '_blank';
      a.rel = 'noopener';
    });

    buildToc(docBody);

    // Reveal BEFORE highlighting and diagramming, both of which are now
    // awaited. mermaid measures rendered text to lay a diagram out, and an
    // element that is still display:none measures as nothing - every <g> came
    // out with transform="translate(undefined, NaN)". It used to get away with
    // running here because mermaid.run() was fire-and-forget and happened to
    // resolve after this flip; awaiting it made that accident load-bearing.
    // Showing the prose first is better anyway: it no longer waits on a
    // ~600 KB highlighter to arrive.
    placeholder.style.display = 'none';
    docBody.style.display = 'block';
    docBody.classList.remove('doc-entering');
    void docBody.offsetHeight; // force reflow to restart animation
    docBody.classList.add('doc-entering');
    window.scrollTo({ top: 0 });
    history.replaceState(null, '', `#${filename}`);

    await enhanceDoc(docBody, () => generation === loadGeneration);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const title = document.createElement('span');
    title.textContent = `⚠️ Failed to load ${filename}`;
    const detail = document.createElement('span');
    detail.style.cssText = 'font-size:var(--text-xs);color:var(--muted-foreground)';
    detail.textContent = msg;
    placeholder.replaceChildren(title, detail);
  }

  if (window.innerWidth <= 768) closeSidebar();
}

// ── Initial load from URL hash or default ──
const initialDoc = NAV_DOCS.some(d => d.file === location.hash.slice(1))
  ? location.hash.slice(1)
  : 'README.md';
loadDoc(initialDoc);

// Don't register the SW from the docs entrypoint. Manifest scope is "/", so
// installing here would claim docs tabs, prompt them to "reload for new
// version", and serve precached docs/index.html that's not always in sync
// with the latest markdown.
