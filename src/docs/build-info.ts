/**
 * Whether a build stamp is something GitHub can resolve as a commit.
 *
 * The stamp is whatever VITE_COMMIT_SHA carried, and only a full 40-character
 * SHA is normalised to short form upstream - anything else is passed through
 * verbatim. A self-hoster building with VITE_COMMIT_SHA=local, or CI passing a
 * tag like v3.0.0, therefore reached the footer as-is and was linked to
 * /commit/local, a hard 404. Linking is now gated on the shape rather than on
 * the single literal "dev", so an unrecognised stamp is still shown - it is
 * useful provenance - just not as a link that cannot resolve.
 */
export function looksLikeCommitSha(value: string): boolean {
  // Hex, a plausible abbreviation length, and at least one a-f.
  //
  // The length range cannot be pinned to 7 and 40: `git rev-parse --short`
  // lengthens the abbreviation as a repository grows, so real stamps of 8, 9
  // or 10 characters exist. But a bare 7-40 hex range also matches an all-digit
  // build stamp like 20250828, which is precisely the value that was being
  // linked to a 404. Requiring a letter separates the two.
  //
  // The cost is a genuinely all-numeric short SHA - about 4% of 7-character
  // ones - rendering as plain text. An occasional missing link is the harmless
  // failure; an occasional broken one is not.
  return /^[0-9a-f]{7,40}$/i.test(value) && /[a-f]/i.test(value);
}

export function initBuildInfo(opts: { appName?: string; buildTime?: string; commitSha?: string } = {}) {
  const appName = (opts.appName ?? import.meta.env.VITE_APP_NAME) || 'frogConvert';
  const buildTime = opts.buildTime ?? (import.meta.env.VITE_BUILD_TIME as string | undefined);
  const commitSha = (opts.commitSha ?? import.meta.env.VITE_COMMIT_SHA) || 'dev';

  document.title = `${appName} Docs`;

  const logoText = document.querySelector('.logo-text');
  if (logoText) logoText.textContent = appName;

  const buildTimeEl = document.getElementById('build-time');
  if (buildTimeEl && buildTime) buildTimeEl.textContent = new Date(buildTime).toLocaleString();

  const commitLink = document.getElementById('commit-link') as HTMLAnchorElement | null;
  if (commitLink) {
    commitLink.textContent = commitSha;
    if (looksLikeCommitSha(commitSha)) {
      commitLink.href = `https://github.com/ogfrench/frogConvert/commit/${commitSha}`;
    } else {
      commitLink.removeAttribute('href');
      commitLink.classList.add('disabled');
      commitLink.onclick = e => e.preventDefault();
    }
  }
}
