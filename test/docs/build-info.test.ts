import { describe, it, expect, beforeEach } from 'vitest';

function setupBuildInfoDOM() {
  document.body.innerHTML = `
    <span class="logo-text"></span>
    <div id="build-time"></div>
    <div id="build-sha">
      <a id="commit-link" href="#">...</a>
    </div>
  `;
}

type BuildInfoModule = typeof import('../../src/docs/build-info.ts');
let mod: BuildInfoModule;

beforeEach(async () => {
  setupBuildInfoDOM();
  mod = await import('../../src/docs/build-info.ts');
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe('initBuildInfo', () => {
  it('sets document title to "<appName> Docs"', () => {
    mod.initBuildInfo({ appName: 'TestApp' });
    expect(document.title).toBe('TestApp Docs');
  });

  it('falls back to "frogConvert" when VITE_APP_NAME is not set', () => {
    mod.initBuildInfo({ appName: '' });
    expect(document.title).toBe('frogConvert Docs');
  });

  it('sets .logo-text to the app name', () => {
    mod.initBuildInfo({ appName: 'MyApp' });
    expect(document.querySelector('.logo-text')?.textContent).toBe('MyApp');
  });

  it('formats and displays the build time', () => {
    const iso = '2025-06-15T12:00:00.000Z';
    mod.initBuildInfo({ buildTime: iso });
    const text = document.getElementById('build-time')?.textContent ?? '';
    // Just check it's a non-empty human-readable string (locale-dependent)
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toBe(iso); // Should be formatted, not raw ISO
  });

  it('shows a link to the GitHub commit when SHA is a real hash', () => {
    mod.initBuildInfo({ commitSha: 'abc1234def' });
    const link = document.getElementById('commit-link') as HTMLAnchorElement;
    expect(link.href).toContain('abc1234def');
    expect(link.textContent).toBe('abc1234def');
  });

  it('adds "disabled" class and prevents click when SHA is "dev"', () => {
    mod.initBuildInfo({ commitSha: 'dev' });
    const link = document.getElementById('commit-link') as HTMLAnchorElement;
    expect(link.classList.contains('disabled')).toBe(true);
    // Simulate click - should not navigate
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('falls back to "dev" when VITE_COMMIT_SHA is not set', () => {
    mod.initBuildInfo({ commitSha: '' });
    const link = document.getElementById('commit-link') as HTMLAnchorElement;
    expect(link.classList.contains('disabled')).toBe(true);
  });
});
