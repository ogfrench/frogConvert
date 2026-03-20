import mermaid from 'mermaid';
import { isDark } from './theme.ts';

// Only re-initialize mermaid when the theme actually changes.
let mermaidTheme: string | null = null;

function ensureMermaid() {
  const theme = isDark() ? 'dark' : 'default';
  if (mermaidTheme === theme) return;
  mermaidTheme = theme;
  const darkVars = { edgeLabelBackground: '#4a4a5a', labelTextColor: '#e2e8f0' };
  mermaid.initialize({
    startOnLoad: false,
    theme,
    themeVariables: theme === 'dark' ? darkVars : {},
  });
}

export function renderMermaid(docBody: HTMLElement) {
  docBody.querySelectorAll('code.language-mermaid').forEach(code => {
    const src = code.textContent ?? '';
    const div = document.createElement('div');
    div.className = 'mermaid';
    div.textContent = src;
    div.dataset.mermaidSrc = src;
    code.closest('pre')?.replaceWith(div);
  });

  ensureMermaid();
  const nodes = [...docBody.querySelectorAll('.mermaid')] as HTMLElement[];
  if (nodes.length) mermaid.run({ nodes });
}

export function rerenderMermaid() {
  ensureMermaid();
  const nodes = [...document.querySelectorAll('#doc-body .mermaid')] as HTMLElement[];
  if (!nodes.length) return;
  nodes.forEach(el => {
    if (el.dataset.mermaidSrc) {
      el.removeAttribute('data-processed');
      el.textContent = el.dataset.mermaidSrc;
    }
  });
  mermaid.run({ nodes });
}
