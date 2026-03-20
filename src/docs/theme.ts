import hljsLightUrl from 'highlight.js/styles/github.min.css?url';
import hljsDarkUrl from 'highlight.js/styles/github-dark.min.css?url';

const html = document.documentElement;
const themeBtn = document.getElementById('theme-toggle')!;

const hljsLightLink = document.createElement('link');
hljsLightLink.rel = 'stylesheet';
hljsLightLink.id = 'hljs-light';
hljsLightLink.href = hljsLightUrl;

const hljsDarkLink = document.createElement('link');
hljsDarkLink.rel = 'stylesheet';
hljsDarkLink.id = 'hljs-dark';
hljsDarkLink.href = hljsDarkUrl;
hljsDarkLink.disabled = true;

document.head.append(hljsLightLink, hljsDarkLink);

export const isDark = () => html.classList.contains('dark');

let transitionTimer: ReturnType<typeof setTimeout> | null = null;

function apply(dark: boolean, animate: boolean, onThemeChange: () => void) {
  if (animate) {
    if (transitionTimer) clearTimeout(transitionTimer);
    html.classList.add('theme-transition');
    void html.offsetHeight; // force reflow before toggling dark
    transitionTimer = setTimeout(() => {
      html.classList.remove('theme-transition');
      transitionTimer = null;
    }, 350);
  }
  html.classList.toggle('dark', dark);
  themeBtn.textContent = dark ? '☼' : '☽';
  localStorage.setItem('theme', dark ? 'dark' : 'light');
  hljsLightLink.disabled = dark;
  hljsDarkLink.disabled = !dark;
  onThemeChange();
}

export function initTheme(onThemeChange: () => void) {
  apply(isDark(), false, onThemeChange);
  themeBtn.addEventListener('click', () => apply(!isDark(), true, onThemeChange));
}
