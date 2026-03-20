import { marked } from 'marked';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';
import { initCustomCursor } from "../components/CustomCursor/CustomCursor.ts";
import { buildToc } from "./toc.ts";
import { initTheme } from "./theme.ts";
import { renderMermaid, rerenderMermaid } from "./mermaid-renderer.ts";
import { initSidebar, setActiveDoc, closeSidebar } from "./sidebar.ts";
import { initBuildInfo } from "./build-info.ts";

interface NavDoc { file: string; icon: string; label: string; desc: string }

const NAV_DOCS = import.meta.env.VITE_NAV_DOCS as unknown as NavDoc[];

initCustomCursor();
initTheme(rerenderMermaid);
initBuildInfo();
initSidebar(NAV_DOCS, loadDoc);

const placeholder = document.getElementById('doc-placeholder')!;
const docBody = document.getElementById('doc-body')!;

async function loadDoc(filename: string) {
  setActiveDoc(filename);

  placeholder.innerHTML = '<div class="loader-spinner"></div><span>Loading…</span>';
  placeholder.style.display = 'flex';
  docBody.style.display = 'none';

  try {
    const res = await fetch(`./${filename}`);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

    // Strip YAML frontmatter before parsing
    const md = (await res.text()).replace(/^---\r?\n[\s\S]*?\r?\n---/, '').trim();
    docBody.innerHTML = DOMPurify.sanitize(await marked.parse(md));

    // Open external links in new tab
    docBody.querySelectorAll<HTMLAnchorElement>('a[href^="http://"], a[href^="https://"]').forEach(a => {
      a.target = '_blank';
      a.rel = 'noopener';
    });

    docBody.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el as HTMLElement));
    renderMermaid(docBody);
    buildToc(docBody);

    placeholder.style.display = 'none';
    docBody.style.display = 'block';
    docBody.classList.remove('doc-entering');
    void docBody.offsetHeight; // force reflow to restart animation
    docBody.classList.add('doc-entering');
    window.scrollTo({ top: 0 });
    history.replaceState(null, '', `#${filename}`);
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
