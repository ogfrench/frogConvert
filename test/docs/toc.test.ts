import { describe, it, expect, beforeEach, vi } from 'vitest';

// jsdom does not implement IntersectionObserver - stub it out
const observeMock = vi.fn();
const disconnectMock = vi.fn();
vi.stubGlobal('IntersectionObserver', class {
  observe = observeMock;
  disconnect = disconnectMock;
  unobserve = vi.fn();
  constructor(public callback: IntersectionObserverCallback) {}
});

// ── DOM fixture ─────────────────────────────────────────────────────────────

function setupTocDOM() {
  document.body.innerHTML = `
    <div id="topbar" style="height:64px"></div>
    <aside id="toc" class="toc-empty">
      <div id="toc-title">On this page</div>
      <nav id="toc-list"></nav>
    </aside>
    <main>
      <div id="doc-body"></div>
    </main>
  `;
}

type TocModule = typeof import('../../src/docs/toc.ts');
let mod: TocModule;

beforeEach(async () => {
  setupTocDOM();
  vi.resetModules();
  mod = await import('../../src/docs/toc.ts');
});

function makeDocBody(html: string): HTMLElement {
  const el = document.getElementById('doc-body')!;
  el.innerHTML = html;
  return el;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('buildToc', () => {
  it('adds "toc-empty" class and empties list when there are no h2/h3 headings', () => {
    const docBody = makeDocBody('<p>No headings here</p>');
    mod.buildToc(docBody);
    expect(document.getElementById('toc')!.classList.contains('toc-empty')).toBe(true);
    expect(document.getElementById('toc-list')!.children).toHaveLength(0);
  });

  it('removes "toc-empty" class when h2 headings are found', () => {
    const docBody = makeDocBody('<h2>Section One</h2><p>Content</p>');
    mod.buildToc(docBody);
    expect(document.getElementById('toc')!.classList.contains('toc-empty')).toBe(false);
  });

  it('creates a link for each h2 heading', () => {
    const docBody = makeDocBody('<h2>Alpha</h2><h2>Beta</h2>');
    mod.buildToc(docBody);
    const links = document.querySelectorAll('#toc-list .toc-link');
    expect(links).toHaveLength(2);
  });

  it('creates links for h3 headings with data-depth="3"', () => {
    const docBody = makeDocBody('<h2>Section</h2><h3>Subsection</h3>');
    mod.buildToc(docBody);
    const h3Link = document.querySelector('#toc-list .toc-link[data-depth="3"]');
    expect(h3Link).not.toBeNull();
    const h2Link = document.querySelector('#toc-list .toc-link:not([data-depth])');
    expect(h2Link).not.toBeNull();
  });

  it('assigns slug IDs to h2/h3 headings', () => {
    const docBody = makeDocBody('<h2>Hello World</h2>');
    mod.buildToc(docBody);
    const heading = docBody.querySelector('h2')!;
    expect(heading.id).toBe('hello-world');
  });

  it('strips special characters when slugifying', () => {
    const docBody = makeDocBody('<h2>API & REST!</h2>');
    mod.buildToc(docBody);
    const heading = docBody.querySelector('h2')!;
    expect(heading.id).not.toMatch(/[&!]/);
    expect(heading.id).toBeTruthy();
  });

  it('generates unique IDs for duplicate heading text', () => {
    const docBody = makeDocBody('<h2>Setup</h2><h2>Setup</h2>');
    mod.buildToc(docBody);
    const headings = docBody.querySelectorAll('h2');
    expect(headings[0].id).not.toBe(headings[1].id);
  });

  it('sets the link href to "#<id>"', () => {
    const docBody = makeDocBody('<h2>Introduction</h2>');
    mod.buildToc(docBody);
    const link = document.querySelector('#toc-list .toc-link') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('#introduction');
  });

  it('uses the heading text content as the link text', () => {
    const docBody = makeDocBody('<h2>Getting Started</h2>');
    mod.buildToc(docBody);
    const link = document.querySelector('#toc-list .toc-link')!;
    expect(link.textContent).toBe('Getting Started');
  });

  it('disconnects the previous observer when called a second time', () => {
    const docBody = makeDocBody('<h2>First</h2>');
    mod.buildToc(docBody);
    // Re-render with different content - should not throw or duplicate
    docBody.innerHTML = '<h2>Second</h2>';
    mod.buildToc(docBody);
    const links = document.querySelectorAll('#toc-list .toc-link');
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe('Second');
  });

  it('skips headings whose text slugifies to empty string', () => {
    // A heading with only special characters would produce an empty slug
    const docBody = makeDocBody('<h2>!!! ??? ###</h2>');
    mod.buildToc(docBody);
    // Heading with empty slug should be skipped - no link created
    const links = document.querySelectorAll('#toc-list .toc-link');
    expect(links).toHaveLength(0);
  });
});
