// Lucide subset (ISC license — github.com/lucide-icons/lucide), inlined
// as SVG strings so we don't pull in a runtime dep. One visual language:
// stroke-width 2, round caps + joins, 24×24 viewBox, currentColor — so a
// single CSS color rule on the host button drives every icon.
//
// Default size 1em — the icon inherits its parent's font-size, which keeps
// it visually paired with adjacent text. Pass an explicit size (px or rem)
// for standalone affordances where parent font-size is wrong (e.g. badges).

const SVG_OPEN =
  '<svg class="lucide" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ' +
  'fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';

function svg(paths: string, size: string | number = '1em'): string {
  const s = typeof size === 'number' ? `${size}` : size;
  return `${SVG_OPEN} width="${s}" height="${s}">${paths}</svg>`;
}

export const Icons = {
  x: (size?: string | number) =>
    svg('<path d="M18 6 6 18M6 6l12 12"/>', size),
  check: (size?: string | number) =>
    svg('<path d="M20 6 9 17l-5-5"/>', size),
  plus: (size?: string | number) =>
    svg('<path d="M5 12h14M12 5v14"/>', size),
  rotateCw: (size?: string | number) =>
    svg('<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>', size),
  refreshCw: (size?: string | number) =>
    svg('<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>', size),
  arrowUp: (size?: string | number) =>
    svg('<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>', size),
  arrowDown: (size?: string | number) =>
    svg('<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>', size),
  arrowRight: (size?: string | number) =>
    svg('<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>', size),
  chevronDown: (size?: string | number) =>
    svg('<path d="m6 9 6 6 6-6"/>', size),
  moreVertical: (size?: string | number) =>
    svg('<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>', size),
};
