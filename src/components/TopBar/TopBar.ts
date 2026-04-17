import "./TopBar.css";
import { ui, formatMode, updateScrollLock, isCategoryVisible, type FormatMode } from "../store/store.ts";
import { safeLocalStorageSet } from "../utils/index.ts";


export function applyMode(mode: FormatMode) {
  formatMode.value = mode;
  const label = mode === "core" ? "Core Formats" : mode === "plus" ? "Core+ Formats" : "All Formats";
  const textEl = ui.modeToggleButton.querySelector('#mode-toggle-text');
  if (textEl) textEl.textContent = label;
  else ui.modeToggleButton.textContent = label;
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

  window.addEventListener("scroll", () => {
    if (ui.topBar) {
      ui.topBar.classList.toggle("scrolled", window.scrollY > 20);
    }
  });

  ui.modeToggleButton.addEventListener("click", () => {
    let nextMode: FormatMode;
    if (formatMode.value === "core") nextMode = "plus";
    else if (formatMode.value === "plus") nextMode = "all";
    else nextMode = "core";

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
  });
}

export function closeMenu() {
  ui.topControls.classList.remove("menu-open");
  updateScrollLock();
}

export function initResponsiveMenu() {
  ui.hamburgerBtn.addEventListener("click", () => {
    ui.topControls.classList.toggle("menu-open");
    updateScrollLock();
  });

  // Close menu when clicking outside
  document.addEventListener("click", (clickEvent) => {
    const target = clickEvent.target as HTMLElement;
    if (!ui.topControls.contains(target) && ui.topControls.classList.contains("menu-open")) {
      ui.topControls.classList.remove("menu-open");
      updateScrollLock();
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

  // Format filter list — call applyMode directly
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
