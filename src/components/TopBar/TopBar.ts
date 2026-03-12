import "./TopBar.css";
import { ui, formatMode, updateScrollLock, isCategoryVisible, type FormatMode } from "../store/store.ts";


export function initModeToggle(onModeChanged: () => void) {
  function applyMode(mode: FormatMode) {
    formatMode.value = mode;
    const label = mode === "core" ? "Core Formats" : mode === "plus" ? "Core+ Formats" : "All Formats";
    ui.modeToggleButton.textContent = label;
    localStorage.setItem("formatMode", mode);

    // Show/hide category tabs with animation
    for (const tab of Array.from(ui.categoryTabs.children) as HTMLElement[]) {
      const categoryName = tab.getAttribute("data-category") || "";
      if (categoryName === "") continue; // Always show "Any"
      tab.classList.toggle("tab-hidden", !isCategoryVisible(categoryName, mode));
    }
  }

  applyMode(formatMode.value);

  window.addEventListener("scroll", () => {
    if (ui.topBar) {
      ui.topBar.classList.toggle("scrolled", window.scrollY > 20);
    }
  });

  ui.modeToggleButton.addEventListener("click", () => {
    // If an advanced-only tab is active, reset to "Any" before switching to core
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
    ui.topControls.classList.remove("menu-open");
    updateScrollLock();
  });
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

// --- Segmented Controls (mobile) ---

export function initSegmentedControls() {
  const modeSegmented = document.querySelector("#mode-segmented") as HTMLDivElement;
  const themeSegmented = document.querySelector("#theme-segmented") as HTMLDivElement;

  // Sync initial state
  syncSegmentedActive(modeSegmented, formatMode.value);

  const isDark = document.documentElement.classList.contains("dark");
  syncSegmentedActive(themeSegmented, isDark ? "dark" : "light");

  bindSegmented(
    modeSegmented,
    ui.modeToggleButton,
    (value) => value !== formatMode.value,
    () => { }
  );

  bindSegmented(
    themeSegmented,
    ui.themeToggleButton,
    (value) => (value === "dark") !== document.documentElement.classList.contains("dark"),
    () => { }
  );

  new MutationObserver(() => {
    syncSegmentedActive(modeSegmented, formatMode.value);
  }).observe(ui.modeToggleButton, { childList: true, characterData: true, subtree: true });

  new MutationObserver(() => {
    const dark = document.documentElement.classList.contains("dark");
    syncSegmentedActive(themeSegmented, dark ? "dark" : "light");
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
}

function bindSegmented(
  container: HTMLElement,
  desktopBtn: HTMLElement,
  isActiveValue: (value: string) => boolean,
  onSelect: (value: string) => void,
) {
  container.addEventListener("click", (clickEvent) => {
    const clickedButton = (clickEvent.target as HTMLElement).closest(".segmented-option") as HTMLButtonElement | null;
    if (!clickedButton || clickedButton.classList.contains("active")) return;
    const value = clickedButton.getAttribute("data-value");
    if (!value) return;

    syncSegmentedActive(container, value);
    if (isActiveValue(value)) {
      // Click the desktop button until the mode matches the selected value (cycles core→plus→all→core)
      let guard = 0;
      while (isActiveValue(value) && guard++ < 3) {
        desktopBtn.click();
      }
    }
    onSelect(value);
  });
}

function syncSegmentedActive(container: HTMLElement, activeValue: string) {
  for (const optionElement of Array.from(container.children) as HTMLElement[]) {
    optionElement.classList.toggle("active", optionElement.getAttribute("data-value") === activeValue);
  }
}
