/**
 * Tests for the build-time frontmatter scanner logic used in vite.config.js
 * to produce VITE_NAV_DOCS.
 *
 * The scanner is extracted here as a pure function so it can be unit-tested
 * without invoking Vite.
 */
import { describe, it, expect } from 'vitest';

// ── Extracted scanner logic (mirrors vite.config.js VITE_NAV_DOCS IIFE) ──

interface NavDoc {
  file: string;
  icon: string;
  label: string;
  desc: string;
}

function parseFrontmatter(content: string): Record<string, string> {
  const fm: Record<string, string> = {};
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return fm;
  match[1].split(/\r?\n/).forEach(line => {
    const [key, ...val] = line.split(':');
    if (key && val.length) fm[key.trim()] = val.join(':').trim();
  });
  return fm;
}

function scanFiles(files: Record<string, string>): NavDoc[] {
  const docs: NavDoc[] = [];
  for (const [file, content] of Object.entries(files)) {
    if (!file.endsWith('.md')) continue;
    const fm = parseFrontmatter(content);
    if (fm.label) {
      docs.push({ file, icon: fm.icon || '📝', label: fm.label, desc: fm.desc || '' });
    }
  }
  return docs;
}

function buildNavDocs(
  rootFiles: Record<string, string>,
  docsFiles: Record<string, string>
): NavDoc[] {
  const all = [...scanFiles(rootFiles), ...scanFiles(docsFiles)];
  const sorted = all.sort((a, b) => {
    const aIsReadme = a.file === 'README.md';
    const bIsReadme = b.file === 'README.md';
    if (aIsReadme && bIsReadme) return 0;
    if (aIsReadme) return -1;
    if (bIsReadme) return 1;
    return a.label.localeCompare(b.label);
  });
  const seen = new Set<string>();
  return sorted.filter(d => {
    if (seen.has(d.file)) return false;
    seen.add(d.file);
    return true;
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('parseFrontmatter', () => {
  it('parses basic key-value frontmatter', () => {
    const content = '---\nlabel: Overview\nicon: 🗺️\ndesc: How it works\n---\n# Body';
    const fm = parseFrontmatter(content);
    expect(fm.label).toBe('Overview');
    expect(fm.icon).toBe('🗺️');
    expect(fm.desc).toBe('How it works');
  });

  it('handles values with colons (e.g. URLs)', () => {
    const content = '---\ndesc: Setup & contributing: a guide\n---\n';
    const fm = parseFrontmatter(content);
    expect(fm.desc).toBe('Setup & contributing: a guide');
  });

  it('returns empty object when no frontmatter is present', () => {
    const fm = parseFrontmatter('# Just markdown, no frontmatter');
    expect(fm).toEqual({});
  });

  it('returns empty object when frontmatter is malformed (no closing ---)', () => {
    const fm = parseFrontmatter('---\nlabel: Broken\n');
    expect(fm).toEqual({});
  });

  it('handles CRLF line endings', () => {
    const content = '---\r\nlabel: Windows\r\nicon: 🪟\r\n---\r\n# Body';
    const fm = parseFrontmatter(content);
    expect(fm.label).toBe('Windows');
    expect(fm.icon).toBe('🪟');
  });
});

describe('scanFiles', () => {
  it('returns a NavDoc for every .md file with a label', () => {
    const files = {
      'README.md': '---\nlabel: Readme\nicon: 📖\ndesc: Project overview\n---\n# Hello',
      'CONTRIBUTING.md': '---\nlabel: Contributing\nicon: 🤝\n---\n# Contribute',
    };
    const docs = scanFiles(files);
    expect(docs).toHaveLength(2);
    expect(docs.map(d => d.file)).toContain('README.md');
    expect(docs.map(d => d.file)).toContain('CONTRIBUTING.md');
  });

  it('skips .md files without frontmatter label', () => {
    const files = {
      'unlabeled.md': '# No frontmatter at all',
      'labeled.md': '---\nlabel: Present\n---\nBody',
    };
    const docs = scanFiles(files);
    expect(docs).toHaveLength(1);
    expect(docs[0].file).toBe('labeled.md');
  });

  it('skips non-.md files', () => {
    const files = {
      'README.md': '---\nlabel: Readme\n---\nBody',
      'image.png': 'binary data',
    };
    const docs = scanFiles(files);
    expect(docs).toHaveLength(1);
  });

  it('defaults icon to 📝 when not provided', () => {
    const files = { 'guide.md': '---\nlabel: Guide\n---\nBody' };
    const [doc] = scanFiles(files);
    expect(doc.icon).toBe('📝');
  });

  it('defaults desc to empty string when not provided', () => {
    const files = { 'guide.md': '---\nlabel: Guide\n---\nBody' };
    const [doc] = scanFiles(files);
    expect(doc.desc).toBe('');
  });
});

describe('buildNavDocs', () => {
  it('puts README.md first regardless of alphabetical order', () => {
    const root = {
      'README.md': '---\nlabel: README\nicon: 📖\n---\nBody',
    };
    const docs = {
      'ARCHITECTURE.md': '---\nlabel: Architecture\n---\nBody',
      'CONTRIBUTING.md': '---\nlabel: Contributing\n---\nBody',
    };
    const nav = buildNavDocs(root, docs);
    expect(nav[0].file).toBe('README.md');
  });

  it('sorts remaining docs alphabetically by label', () => {
    const root = { 'README.md': '---\nlabel: README\n---\nBody' };
    const docs = {
      'Z.md': '---\nlabel: Zebra\n---\nBody',
      'A.md': '---\nlabel: Apple\n---\nBody',
    };
    const nav = buildNavDocs(root, docs);
    expect(nav[1].label).toBe('Apple');
    expect(nav[2].label).toBe('Zebra');
  });

  it('de-duplicates by filename, keeping root version over docs version', () => {
    const root = { 'README.md': '---\nlabel: Root README\n---\nBody' };
    const docs = { 'README.md': '---\nlabel: Docs README\n---\nBody' };
    const nav = buildNavDocs(root, docs);
    // Root is scanned first → stable sort keeps it first → de-dup takes it
    expect(nav.filter(d => d.file === 'README.md')).toHaveLength(1);
    expect(nav.find(d => d.file === 'README.md')?.label).toBe('Root README');
  });

  it('returns empty array when no files have frontmatter labels', () => {
    const nav = buildNavDocs({ 'README.md': '# No frontmatter' }, {});
    expect(nav).toHaveLength(0);
  });
});
