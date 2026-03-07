import "./CategoryTabs.css";
import { ui, DEFAULT_UPLOAD_TEXT, DEFAULT_UPLOAD_LABEL } from "../store/store.ts";

// --- Category tabs ---

let categoryChangeCallback: ((category: string) => void) | null = null;

export function initCategoryTabs(
  onCategoryChange: (category: string) => void,
) {
  categoryChangeCallback = onCategoryChange;

  ui.categoryTabs.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (!target.classList.contains("cat-tab")) return;

    const category = target.getAttribute("data-category") || "";
    selectCategoryTab(category);
  });
}

export function selectCategoryTab(category: string) {
  const tabs = Array.from(ui.categoryTabs.children) as HTMLElement[];
  const targetTab = tabs.find(tab => tab.getAttribute("data-category") === category);

  if (!targetTab) return;

  for (const tab of tabs) {
    tab.classList.remove("active");
  }
  targetTab.classList.add("active");

  if (categoryChangeCallback) {
    categoryChangeCallback(category);
  }
}

export function updateCategoryText(hasFiles: boolean) {
  if (!hasFiles) {
    ui.uploadText.textContent = DEFAULT_UPLOAD_TEXT;
    ui.uploadLabel.textContent = DEFAULT_UPLOAD_LABEL;
  }
}
