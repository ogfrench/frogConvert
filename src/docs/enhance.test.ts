// enhanceDoc is the half of loadDoc that was actually broken. Both of its steps
// measure rendered layout, so both must run after the document is revealed, and
// both sit behind dynamic imports that a second navigation can overtake.
//
// It lives in its own module precisely so this file can import it: docs.ts runs
// a bootstrap on import and dies in jsdom on window.matchMedia, which is how an
// earlier version of this test passed while testing nothing.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { enhanceDoc } from './enhance.ts';

function docWith(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

describe('enhanceDoc', () => {
  it('is importable without a bootstrap, unlike docs.ts', () => {
    // Guards the reason this module was split out. If enhanceDoc drifts back
    // into docs.ts, this file stops compiling rather than silently no-opping.
    expect(typeof enhanceDoc).toBe('function');
  });

  it('does nothing at all when already superseded', async () => {
    // An older loadDoc resuming after its await must not touch the newer
    // document. mermaid stamps data-processed before awaiting its render and
    // skips anything already stamped, so a stray run leaves the new document's
    // diagrams permanently blank.
    const root = docWith('<pre><code class="language-mermaid">graph TD; A--&gt;B;</code></pre>');
    await enhanceDoc(root, () => false);
    expect(root.querySelector('code.language-mermaid')).not.toBeNull();
    expect(root.querySelector('.mermaid')).toBeNull();
  });

  it('returns without loading anything for a document with no code and no diagram', async () => {
    // The whole point of the lazy split: prose must not fetch a highlighter or
    // a diagram renderer.
    const root = docWith('<h1>Title</h1><p>Just prose.</p>');
    await expect(enhanceDoc(root)).resolves.toBeUndefined();
    expect(root.querySelector('.mermaid')).toBeNull();
  });

  it('converts mermaid fences to .mermaid nodes before rendering them', async () => {
    const root = docWith('<pre><code class="language-mermaid">graph TD; A--&gt;B;</code></pre>');
    await enhanceDoc(root);
    // The renderer itself cannot draw under jsdom, but the fence-to-node
    // conversion is ours and must have happened.
    const node = root.querySelector('.mermaid') as HTMLElement | null;
    expect(node).not.toBeNull();
    expect(node!.dataset.mermaidSrc).toContain('graph TD');
  });

  it('highlights the code blocks it finds', async () => {
    const root = docWith('<pre><code class="language-ts">const a = 1;</code></pre>');
    await enhanceDoc(root);
    const code = root.querySelector('pre code')!;
    expect(code.classList.contains('hljs')).toBe(true);
    expect(code.querySelectorAll('[class^=hljs-]').length).toBeGreaterThan(0);
  });

  it('survives a highlighter that fails to load', async () => {
    // A stale chunk after a deploy. Unhighlighted code is still readable, so
    // this must warn rather than reject into loadDoc's catch, which would
    // replace a rendered page with an error placeholder.
    vi.resetModules();
    vi.doMock('highlight.js', () => { throw new Error('chunk 404'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { enhanceDoc: fresh } = await import('./enhance.ts');
      const root = docWith('<pre><code class="language-ts">const a = 1;</code></pre>');
      await expect(fresh(root)).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith(
        '[docs] syntax highlighting unavailable:', expect.anything()
      );
      expect(root.querySelector('pre code')!.classList.contains('hljs')).toBe(false);
    } finally {
      vi.doUnmock('highlight.js');
      vi.resetModules();
    }
  });

  it('leaves mermaid fences out of the highlighter selector', async () => {
    // They are replaced outright by the renderer, so highlighting them is work
    // thrown away - and on failure would leave a half-styled fence behind.
    const root = docWith(
      '<pre><code class="language-mermaid">graph TD; A--&gt;B;</code></pre>' +
      '<pre><code class="language-ts">const a = 1;</code></pre>'
    );
    const selected = root.querySelectorAll('pre code:not(.language-mermaid)');
    expect(selected.length).toBe(1);
    expect(selected[0].className).toBe('language-ts');
  });
});
