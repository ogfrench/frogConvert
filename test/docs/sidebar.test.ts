import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── DOM fixture ─────────────────────────────────────────────────────────────

function setupDocsDOM() {
  document.body.innerHTML = `
    <nav id="sidebar">
      <div id="sidebar-items"></div>
    </nav>
    <div id="sidebar-overlay"></div>
    <button id="nav-toggle"></button>
  `;
}

// Import the module after DOM is set up.
// sidebar.ts accesses the DOM at module scope, so we use resetModules +
// dynamic import inside beforeEach to get a fresh module each test.
type SidebarModule = typeof import('../../src/docs/sidebar.ts');
let mod: SidebarModule;

beforeEach(async () => {
  setupDocsDOM();
  vi.resetModules();
  mod = await import('../../src/docs/sidebar.ts');
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('initSidebar', () => {
  it('creates a nav button for each doc entry', () => {
    const docs = [
      { file: 'README.md', icon: '📖', label: 'README', desc: 'Overview' },
      { file: 'CONTRIBUTING.md', icon: '🤝', label: 'Contributing', desc: 'How to contribute' },
    ];
    mod.initSidebar(docs, vi.fn());
    const buttons = document.querySelectorAll('.nav-item');
    expect(buttons).toHaveLength(2);
  });

  it('sets data-doc attribute on each button', () => {
    const docs = [{ file: 'guide.md', icon: '📝', label: 'Guide', desc: '' }];
    mod.initSidebar(docs, vi.fn());
    const btn = document.querySelector('[data-doc="guide.md"]');
    expect(btn).not.toBeNull();
  });

  it('renders icon and label text in each button', () => {
    const docs = [{ file: 'guide.md', icon: '📝', label: 'Guide', desc: 'A description' }];
    mod.initSidebar(docs, vi.fn());
    const btn = document.querySelector('[data-doc="guide.md"]') as HTMLElement;
    expect(btn.querySelector('.nav-icon')?.textContent).toBe('📝');
    expect(btn.textContent).toContain('Guide');
    expect(btn.textContent).toContain('A description');
  });

  it('calls the onDocSelect callback when a button is clicked', () => {
    const onSelect = vi.fn();
    const docs = [{ file: 'guide.md', icon: '📝', label: 'Guide', desc: '' }];
    mod.initSidebar(docs, onSelect);
    (document.querySelector('[data-doc="guide.md"]') as HTMLElement).click();
    expect(onSelect).toHaveBeenCalledWith('guide.md');
  });

  it('adds a "Documentation" section label above the nav items', () => {
    mod.initSidebar([], vi.fn());
    const label = document.querySelector('.sidebar-section-label');
    expect(label?.textContent).toBe('Documentation');
  });

  it('toggles sidebar open/closed when nav-toggle is clicked', () => {
    mod.initSidebar([], vi.fn());
    const sidebar = document.getElementById('sidebar')!;
    const toggle = document.getElementById('nav-toggle')!;
    toggle.click();
    expect(sidebar.classList.contains('open')).toBe(true);
    toggle.click();
    expect(sidebar.classList.contains('open')).toBe(false);
  });

  it('closes sidebar when overlay is clicked', () => {
    mod.initSidebar([], vi.fn());
    const sidebar = document.getElementById('sidebar')!;
    const toggle = document.getElementById('nav-toggle')!;
    const overlay = document.getElementById('sidebar-overlay')!;
    toggle.click(); // open first
    expect(sidebar.classList.contains('open')).toBe(true);
    overlay.click();
    expect(sidebar.classList.contains('open')).toBe(false);
  });
});

describe('setActiveDoc', () => {
  it('adds "active" class to the matching nav button', () => {
    const docs = [
      { file: 'a.md', icon: '📝', label: 'A', desc: '' },
      { file: 'b.md', icon: '📝', label: 'B', desc: '' },
    ];
    mod.initSidebar(docs, vi.fn());
    mod.setActiveDoc('a.md');
    expect(document.querySelector('[data-doc="a.md"]')?.classList.contains('active')).toBe(true);
    expect(document.querySelector('[data-doc="b.md"]')?.classList.contains('active')).toBe(false);
  });

  it('removes "active" from the previously active button', () => {
    const docs = [
      { file: 'a.md', icon: '📝', label: 'A', desc: '' },
      { file: 'b.md', icon: '📝', label: 'B', desc: '' },
    ];
    mod.initSidebar(docs, vi.fn());
    mod.setActiveDoc('a.md');
    mod.setActiveDoc('b.md');
    expect(document.querySelector('[data-doc="a.md"]')?.classList.contains('active')).toBe(false);
    expect(document.querySelector('[data-doc="b.md"]')?.classList.contains('active')).toBe(true);
  });
});

describe('closeSidebar', () => {
  it('removes "open" and "visible" classes from sidebar and overlay', () => {
    const sidebar = document.getElementById('sidebar')!;
    const overlay = document.getElementById('sidebar-overlay')!;
    sidebar.classList.add('open');
    overlay.classList.add('visible');
    mod.closeSidebar();
    expect(sidebar.classList.contains('open')).toBe(false);
    expect(overlay.classList.contains('visible')).toBe(false);
  });
});
