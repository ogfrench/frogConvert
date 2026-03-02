import "./Popup.css";
import { ui } from "../store/store.ts";

// --- Popup ---

export function showPopup(html: string) {
  ui.popupBox.innerHTML = html;
  ui.popupBox.style.display = "block";
  ui.popupBackground.style.display = "block";
}

export function hidePopup() {
  ui.popupBox.style.display = "none";
  ui.popupBackground.style.display = "none";
}
