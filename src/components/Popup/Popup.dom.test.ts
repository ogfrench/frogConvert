import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ui } from "../store/store.ts";
import { showPopup, hidePopup, createPopupButton, showAlertPopup } from "./Popup.ts";

describe("Popup DOM components", () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div id="popup-bg" style="display: none;"></div>
            <div id="popup" class="card-base" style="display: none;"></div>
        `;
        ui.popupBackground = document.getElementById("popup-bg") as HTMLDivElement;
        ui.popupBox = document.getElementById("popup") as HTMLDivElement;
    });

    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("showPopup renders content and shows the modal", () => {
        showPopup("<h2>Test Title</h2>");
        expect(ui.popupBox.innerHTML).toContain("<h2>Test Title</h2>");
        expect(ui.popupBox.classList.contains("open")).toBe(true);
        expect(ui.popupBackground.classList.contains("open")).toBe(true);
    });

    it("hidePopup hides the modal", () => {
        showPopup("Test");
        hidePopup();
        expect(ui.popupBox.classList.contains("open")).toBe(false);
        expect(ui.popupBackground.classList.contains("open")).toBe(false);
    });

    it("createPopupButton creates a button with correct text and action", () => {
        const onClick = vi.fn();
        const btn = createPopupButton("Click me", "test-class", onClick);

        expect(btn.tagName).toBe("BUTTON");
        expect(btn.textContent).toBe("Click me");
        expect(btn.className).toBe("test-class");

        btn.click();
        expect(onClick).toHaveBeenCalledOnce();
    });

    it("showAlertPopup renders title, message and button", () => {
        showAlertPopup("Alert Title", "Alert message <b>bold</b>", "Close now");

        expect(ui.popupBox.querySelector("h2")?.textContent).toBe("Alert Title");
        expect(ui.popupBox.querySelector("p")?.innerHTML).toBe("Alert message <b>bold</b>");

        const btn = ui.popupBox.querySelector("button") as HTMLButtonElement;
        expect(btn.textContent).toBe("Close now");
        expect(btn.className).toBe("btn-primary");

        btn.click();
        expect(ui.popupBox.classList.contains("open")).toBe(false);
    });
});
