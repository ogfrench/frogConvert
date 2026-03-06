import "./Popup.css";
import { ui } from "../store/store.ts";

// --- Popup ---

const HIDE_MS = 160;

export function showPopup(html: string) {
  ui.popupBox.classList.remove("closing", "popup-visible");
  ui.popupBackground.classList.remove("closing", "popup-visible");
  ui.popupBox.innerHTML = html;
  ui.popupBox.style.display = "block";
  ui.popupBackground.style.display = "block";
  void ui.popupBox.offsetWidth; // force reflow to restart animation
  ui.popupBox.classList.add("popup-visible");
  ui.popupBackground.classList.add("popup-visible");
}

export function hidePopup() {
  ui.popupBox.classList.remove("popup-visible");
  ui.popupBackground.classList.remove("popup-visible");
  ui.popupBox.classList.add("closing");
  ui.popupBackground.classList.add("closing");
  setTimeout(() => {
    ui.popupBox.style.display = "none";
    ui.popupBackground.style.display = "none";
    ui.popupBox.classList.remove("closing");
    ui.popupBackground.classList.remove("closing");
  }, HIDE_MS);
}
