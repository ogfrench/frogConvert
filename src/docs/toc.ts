const tocEl = document.getElementById('toc')!;
const tocListEl = document.getElementById('toc-list')!;

let observer: IntersectionObserver | null = null;

function slugify(text: string): string {
  return text.toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function scrollToHeading(h: HTMLElement) {
  const topbarH = document.getElementById('topbar')?.offsetHeight ?? 0;
  const top = h.getBoundingClientRect().top + window.scrollY - topbarH - 8;
  window.scrollTo({ top, behavior: 'smooth' });
}

export function buildToc(docBody: HTMLElement) {
  tocListEl.innerHTML = '';
  if (observer) { observer.disconnect(); observer = null; }

  const headings = [...docBody.querySelectorAll('h2, h3')] as HTMLElement[];

  if (headings.length === 0) {
    tocEl.classList.add('toc-empty');
    return;
  }

  // Assign stable IDs
  const slugCounts: Record<string, number> = {};
  headings.forEach(h => {
    const base = slugify(h.textContent ?? '');
    if (!base) return;
    slugCounts[base] = (slugCounts[base] ?? 0) + 1;
    h.id = slugCounts[base] > 1 ? `${base}-${slugCounts[base]}` : base;
  });

  // Build link elements - skip headings whose text had no sluggifiable content
  headings.forEach(h => {
    if (!h.id) return;
    const a = document.createElement('a');
    a.className = 'toc-link';
    a.href = `#${h.id}`;
    a.textContent = h.textContent ?? '';
    if (h.tagName === 'H3') a.dataset.depth = '3';
    a.style.setProperty('--toc-index', String(tocListEl.children.length));
    a.addEventListener('click', e => { e.preventDefault(); scrollToHeading(h); });
    tocListEl.appendChild(a);
  });

  // Highlight active heading on scroll
  const links = [...tocListEl.querySelectorAll<HTMLAnchorElement>('.toc-link')];

  const obs = new IntersectionObserver(
    entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          links.forEach(l => l.classList.toggle('active', l.getAttribute('href') === `#${id}`));
        }
      });
    },
    { rootMargin: '-80px 0px -70% 0px', threshold: 0 }
  );
  observer = obs;

  headings.forEach(h => { if (h.id) obs.observe(h); });
  tocEl.classList.remove('toc-empty');
}
