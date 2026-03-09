import "./TopBar.css";
import { ui, isAdvancedMode, updateScrollLock } from "../store/store.ts";

// --- Mode Toggle ---

/** Categories only shown in advanced (All Formats) mode. */
const ADVANCED_ONLY_CATEGORIES = ["code", "other"];

export function initModeToggle(onModeChanged: () => void) {
  function applyMode(advanced: boolean) {
    isAdvancedMode.value = advanced;
    ui.modeToggleButton.textContent = advanced ? "All Formats" : "Core Formats";
    localStorage.setItem("formatMode", advanced ? "advanced" : "basic");

    // Show/hide advanced-only category tabs with animation
    for (const tab of Array.from(ui.categoryTabs.children) as HTMLElement[]) {
      const categoryName = tab.getAttribute("data-category") || "";
      if (ADVANCED_ONLY_CATEGORIES.includes(categoryName)) {
        tab.classList.toggle("tab-hidden", !advanced);
      }
    }
  }

  applyMode(isAdvancedMode.value);

  window.addEventListener("scroll", () => {
    if (ui.topBar) {
      ui.topBar.classList.toggle("scrolled", window.scrollY > 20);
    }
  });

  ui.modeToggleButton.addEventListener("click", () => {
    // If an advanced-only tab is active, reset to "Any" before switching to core
    if (isAdvancedMode.value) {
      const activeTab = ui.categoryTabs.querySelector(".cat-tab.active") as HTMLElement | null;
      const activeCat = activeTab?.getAttribute("data-category") || "";
      if (ADVANCED_ONLY_CATEGORIES.includes(activeCat)) {
        activeTab?.classList.remove("active");
        const anyTab = ui.categoryTabs.querySelector('.cat-tab[data-category=""]') as HTMLElement | null;
        anyTab?.classList.add("active");
        anyTab?.click();
      }
    }
    applyMode(!isAdvancedMode.value);
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
  const isAdvanced = localStorage.getItem("formatMode") === "advanced";
  syncSegmentedActive(modeSegmented, isAdvanced ? "advanced" : "basic");

  const isDark = document.documentElement.classList.contains("dark");
  syncSegmentedActive(themeSegmented, isDark ? "dark" : "light");

  bindSegmented(
    modeSegmented,
    ui.modeToggleButton,
    (value) => (value === "advanced") !== isAdvancedMode.value,
    () => { }
  );

  bindSegmented(
    themeSegmented,
    ui.themeToggleButton,
    (value) => (value === "dark") !== document.documentElement.classList.contains("dark"),
    () => { }
  );

  new MutationObserver(() => {
    syncSegmentedActive(modeSegmented, isAdvancedMode.value ? "advanced" : "basic");
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
      desktopBtn.click();
    }
    onSelect(value);
  });
}

function syncSegmentedActive(container: HTMLElement, activeValue: string) {
  for (const optionElement of Array.from(container.children) as HTMLElement[]) {
    optionElement.classList.toggle("active", optionElement.getAttribute("data-value") === activeValue);
  }
}
