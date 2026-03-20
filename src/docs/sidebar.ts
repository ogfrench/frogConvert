type NavDoc = { file: string; icon: string; label: string; desc: string };

const sidebarEl = document.getElementById('sidebar')!;
const overlayEl = document.getElementById('sidebar-overlay')!;
const navToggleEl = document.getElementById('nav-toggle')!;

export function closeSidebar() {
  sidebarEl.classList.remove('open');
  overlayEl.classList.remove('visible');
}

export function setActiveDoc(filename: string) {
  document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
  document.querySelector(`[data-doc="${filename}"]`)?.classList.add('active');
}

export function initSidebar(docs: NavDoc[], onDocSelect: (file: string) => void) {
  const itemsEl = document.getElementById('sidebar-items')!;

  const label = document.createElement('div');
  label.className = 'sidebar-section-label';
  label.textContent = 'Documentation';
  itemsEl.appendChild(label);

  docs.forEach(({ file, icon, label: text, desc }) => {
    const btn = document.createElement('button');
    btn.className = 'nav-item';
    btn.dataset.doc = file;

    const iconSpan = document.createElement('span');
    iconSpan.className = 'nav-icon';
    iconSpan.textContent = icon;

    const textSpan = document.createElement('span');
    textSpan.textContent = text;

    const descSpan = document.createElement('span');
    descSpan.className = 'nav-desc';
    descSpan.textContent = desc;

    textSpan.appendChild(descSpan);
    btn.append(iconSpan, textSpan);
    btn.addEventListener('click', () => onDocSelect(file));
    itemsEl.appendChild(btn);
  });

  navToggleEl.addEventListener('click', () => {
    const open = sidebarEl.classList.toggle('open');
    overlayEl.classList.toggle('visible', open);
  });
  overlayEl.addEventListener('click', closeSidebar);
}
