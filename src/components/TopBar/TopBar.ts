import "./TopBar.css";
import { registerExclusiveMenu } from "./exclusiveMenus.ts";
import { ui, formatMode, updateScrollLock, isCategoryVisible, type FormatMode } from "../store/store.ts";
import { safeLocalStorageSet } from "../utils/index.ts";


/** Single source for the labels, so the button, the menu and the aria text
 *  cannot drift apart the way three separate literals would. */
export const FORMAT_MODE_LABELS: Record<FormatMode, string> = {
  core: "Core Formats",
  plus: "Core+ Formats",
  all: "All Formats",
};

export function applyMode(mode: FormatMode) {
  formatMode.value = mode;
  const label = FORMAT_MODE_LABELS[mode];
  const textEl = ui.modeToggleButton.querySelector('#mode-toggle-text');
  if (textEl) textEl.textContent = label;
  else ui.modeToggleButton.textContent = label;
  ui.modeToggleButton.setAttribute("aria-label", `Format filter: ${label}. Change`);
  ui.modeToggleButton.title = `Formats offered: ${label}`;
  // Mark the chosen row wherever the menu exists. Same contract as the
  // compression menu, so both read identically to assistive tech.
  for (const item of document.querySelectorAll<HTMLElement>("#format-mode-menu .quality-item")) {
    item.setAttribute("aria-current", String(item.dataset.value === mode));
  }
  safeLocalStorageSet("formatMode", mode);

  // Show/hide category tabs with animation
  for (const tab of Array.from(ui.categoryTabs.children) as HTMLElement[]) {
    const categoryName = tab.getAttribute("data-category") || "";
    if (categoryName === "") continue; // Always show "Any"
    tab.classList.toggle("tab-hidden", !isCategoryVisible(categoryName, mode));
  }
}

export function initModeToggle(onModeChanged: () => void) {
  applyMode(formatMode.value);

  // rAF-coalesced so a fast scroll fires the class toggle at most once per
  // frame instead of per scroll event (40-100x reduction in style recalcs).
  let scrollPending = false;
  window.addEventListener("scroll", () => {
    if (scrollPending) return;
    scrollPending = true;
    requestAnimationFrame(() => {
      scrollPending = false;
      if (ui.topBar) {
        ui.topBar.classList.toggle("scrolled", window.scrollY > 20);
      }
    });
  }, { passive: true });

  // A dropdown, not a three-state cycle. Cycling hid the options entirely:
  // you could not see what was on offer, could not jump to one, and had to
  // press twice to go back a step - all to reach a setting that changes what
  // the whole format list contains.
  const menu = document.getElementById("format-mode-menu");

  const closeOtherMenus = registerExclusiveMenu(() => {
    if (menu) setMenuOpen(false);
  });

  const setMenuOpen = (open: boolean) => {
    if (!menu) return;
    if (open) closeOtherMenus();
    menu.hidden = !open;
    ui.modeToggleButton.setAttribute("aria-expanded", String(open));
    if (open) menu.querySelector<HTMLElement>('[aria-current="true"], .quality-item')?.focus();
  };

  const choose = (nextMode: FormatMode) => {
    setMenuOpen(false);
    if (nextMode === formatMode.value) return;
    // The active category tab may not exist in the mode being moved to; leave
    // the user on a tab that shows nothing and the page looks broken.
    const activeTab = ui.categoryTabs.querySelector(".cat-tab.active") as HTMLElement | null;
    const activeCat = activeTab?.getAttribute("data-category") || "";
    if (!isCategoryVisible(activeCat, nextMode)) {
      activeTab?.classList.remove("active");
      const anyTab = ui.categoryTabs.querySelector('.cat-tab[data-category=""]') as HTMLElement | null;
      anyTab?.classList.add("active");
      anyTab?.click();
    }
    applyMode(nextMode);
    onModeChanged();
  };

  ui.modeToggleButton.addEventListener("click", (e) => {
    e.stopPropagation();
    // No menu in the DOM (older markup, or a test harness stub): fall back to
    // the cycle so the control still does something rather than nothing.
    if (!menu) {
      choose(formatMode.value === "core" ? "plus" : formatMode.value === "plus" ? "all" : "core");
      return;
    }
    setMenuOpen(menu.hidden);
  });

  menu?.addEventListener("click", (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>(".quality-item");
    if (item?.dataset.value) choose(item.dataset.value as FormatMode);
  });

  // Escape and click-away, matching what the compression menu does.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !menu || menu.hidden) return;
    setMenuOpen(false);
    ui.modeToggleButton.focus();
  });
  document.addEventListener("click", (e) => {
    if (!menu || menu.hidden) return;
    if ((e.target as HTMLElement).closest("#format-mode-picker")) return;
    setMenuOpen(false);
  });
}

// Tracks the element that opened the menu so focus can be restored on close
// (otherwise keyboard users land at <body> after Esc).
let menuOpenedFrom: HTMLElement | null = null;

function focusableInMenu(): HTMLElement[] {
  const menu = document.getElementById("top-controls-menu");
  if (!menu) return [];
  return Array.from(menu.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  )).filter(el => !el.hasAttribute("disabled") && el.offsetParent !== null);
}

function setMenuOpen(open: boolean) {
  ui.topControls.classList.toggle("menu-open", open);
  ui.hamburgerBtn.setAttribute("aria-expanded", String(open));
  updateScrollLock();
  if (open) {
    menuOpenedFrom = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => focusableInMenu()[0]?.focus());
  } else if (menuOpenedFrom) {
    menuOpenedFrom.focus();
    menuOpenedFrom = null;
  }
}

export function closeMenu() {
  if (!ui.topControls.classList.contains("menu-open")) return;
  setMenuOpen(false);
}

export function initResponsiveMenu() {
  ui.hamburgerBtn.addEventListener("click", () => {
    setMenuOpen(!ui.topControls.classList.contains("menu-open"));
  });

  // Close menu when clicking outside
  document.addEventListener("click", (clickEvent) => {
    const target = clickEvent.target as HTMLElement;
    if (!ui.topControls.contains(target) && ui.topControls.classList.contains("menu-open")) {
      setMenuOpen(false);
    }
  });

  // Esc closes; Tab/Shift+Tab cycles within the menu (focus trap).
  document.addEventListener("keydown", (e) => {
    if (!ui.topControls.classList.contains("menu-open")) return;
    if (e.key === "Escape") {
      e.preventDefault();
      setMenuOpen(false);
      return;
    }
    if (e.key !== "Tab") return;
    const focusables = focusableInMenu();
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  });
}

// --- Pill Controls (mobile menu) ---

export function initSegmentedControls(onModeChanged: () => void) {
  const formatsList = document.querySelector("#formats-section") as HTMLDivElement;
  const themePills = document.querySelector("#theme-segmented") as HTMLDivElement;

  // Track last-synced values so MutationObservers skip redundant updates
  let lastSyncedMode = formatMode.value;
  let lastSyncedTheme = document.documentElement.classList.contains("dark") ? "dark" : "light";

  // Sync initial state
  syncActive(formatsList, ".pill-option", formatMode.value);
  syncActive(themePills, ".pill-option", lastSyncedTheme);

  // Format filter list, call applyMode directly
  formatsList.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest(".pill-option") as HTMLElement | null;
    if (!btn || btn.classList.contains("active")) return;
    const value = btn.getAttribute("data-value") as FormatMode | null;
    if (!value || value === formatMode.value) return;

    // If the active category tab won't be visible in the new mode, reset to "Any"
    const activeTab = ui.categoryTabs.querySelector(".cat-tab.active") as HTMLElement | null;
    const activeCat = activeTab?.getAttribute("data-category") || "";
    if (!isCategoryVisible(activeCat, value)) {
      activeTab?.classList.remove("active");
      const anyTab = ui.categoryTabs.querySelector('.cat-tab[data-category=""]') as HTMLElement | null;
      anyTab?.classList.add("active");
      anyTab?.click();
    }

    applyMode(value);
    onModeChanged();
    syncActive(formatsList, ".pill-option", value);
    lastSyncedMode = value;
  });

  // Theme pills
  themePills.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest(".pill-option") as HTMLElement | null;
    if (!btn || btn.classList.contains("active")) return;
    const value = btn.getAttribute("data-value");
    if (!value) return;
    const wantDark = value === "dark";
    if (wantDark !== document.documentElement.classList.contains("dark")) {
      ui.themeToggleButton.click();
    }
    syncActive(themePills, ".pill-option", value);
    lastSyncedTheme = value;
  });

  // Keep mobile controls in sync when desktop controls change
  new MutationObserver(() => {
    if (formatMode.value === lastSyncedMode) return;
    lastSyncedMode = formatMode.value;
    syncActive(formatsList, ".pill-option", formatMode.value);
  }).observe(ui.modeToggleButton, { childList: true, characterData: true, subtree: true });

  new MutationObserver(() => {
    const theme = document.documentElement.classList.contains("dark") ? "dark" : "light";
    if (theme === lastSyncedTheme) return;
    lastSyncedTheme = theme;
    syncActive(themePills, ".pill-option", theme);
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
}

function syncActive(container: HTMLElement, selector: string, activeValue: string) {
  for (const opt of container.querySelectorAll(selector) as NodeListOf<HTMLElement>) {
    const isActive = opt.getAttribute("data-value") === activeValue;
    opt.classList.toggle("active", isActive);
    if (opt.hasAttribute("aria-pressed")) opt.setAttribute("aria-pressed", String(isActive));
  }
}
