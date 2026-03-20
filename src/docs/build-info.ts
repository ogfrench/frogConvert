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
    if (commitSha !== 'dev') {
      commitLink.href = `https://github.com/ogfrench/frogConvert/commit/${commitSha}`;
    } else {
      commitLink.classList.add('disabled');
      commitLink.onclick = e => e.preventDefault();
    }
  }
}
