/**
 * Tests for docs.ts utilities.
 *
 * loadDoc is not exported (it runs as an IIFE-style bootstrap), so we test
 * the key logic units that are independently verifiable without spinning up
 * the full module (which would pull in mermaid, hljs, etc.).
 */
import { describe, it, expect } from 'vitest';

// ── Frontmatter stripping ─────────────────────────────────────────────────
// Mirrors the inline regex in docs.ts:
//   (await res.text()).replace(/^---\r?\n[\s\S]*?\r?\n---/, '').trim()

function stripFrontmatter(md: string): string {
  return md.replace(/^---\r?\n[\s\S]*?\r?\n---/, '').trim();
}

describe('frontmatter stripping regex', () => {
  it('removes a valid YAML frontmatter block', () => {
    const input = '---\nlabel: Test\nicon: 📝\n---\n# Heading\n\nBody.';
    expect(stripFrontmatter(input)).toBe('# Heading\n\nBody.');
  });

  it('leaves documents without frontmatter unchanged', () => {
    const input = '# Just a heading\n\nParagraph.';
    expect(stripFrontmatter(input)).toBe(input);
  });

  it('handles CRLF line endings in frontmatter', () => {
    const input = '---\r\nlabel: Win\r\n---\r\n# Content';
    expect(stripFrontmatter(input)).toBe('# Content');
  });

  it('does not strip a --- that appears mid-document', () => {
    const input = '# Heading\n\n---\n\nA horizontal rule.';
    expect(stripFrontmatter(input)).toBe(input);
  });

  it('returns empty string when the document is only frontmatter', () => {
    const input = '---\nlabel: Only meta\n---\n';
    expect(stripFrontmatter(input)).toBe('');
  });
});

// ── Hash-based initial doc resolution ────────────────────────────────────
// Mirrors: NAV_DOCS.some(d => d.file === hash) ? hash : 'README.md'

function resolveInitialDoc(navDocs: { file: string }[], hash: string): string {
  return navDocs.some(d => d.file === hash) ? hash : 'README.md';
}

describe('initial doc resolution from URL hash', () => {
  const nav = [
    { file: 'README.md' },
    { file: 'CONTRIBUTING.md' },
  ];

  it('loads the doc matching the hash when it exists in NAV_DOCS', () => {
    expect(resolveInitialDoc(nav, 'CONTRIBUTING.md')).toBe('CONTRIBUTING.md');
  });

  it('falls back to README.md when hash is empty', () => {
    expect(resolveInitialDoc(nav, '')).toBe('README.md');
  });

  it('falls back to README.md when hash is unknown', () => {
    expect(resolveInitialDoc(nav, 'nonexistent.md')).toBe('README.md');
  });

  it('uses README.md from hash when NAV_DOCS contains it', () => {
    expect(resolveInitialDoc(nav, 'README.md')).toBe('README.md');
  });
});
