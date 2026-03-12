import { updateScrollLock } from "../store/store.ts";

export class ModalManager {
    private static activeModals: {
        modal: HTMLElement;
        bg: HTMLElement;
        opener: Element | null;
        onClose?: () => void;
        persistent?: boolean;
    }[] = [];

    static open(modal: HTMLElement, bg: HTMLElement, onClose?: () => void, persistent = false) {
        const opener = document.activeElement;
        this.activeModals.push({ modal, bg, opener, onClose, persistent });

        modal.classList.add("open");
        bg.classList.add("open");
        modal.removeAttribute("aria-hidden");
        updateScrollLock();

        // Accessibility: Focus first focusable element or modal itself
        const focusable = modal.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') as HTMLElement;
        if (focusable) focusable.focus();
        else modal.focus();
    }

    static close(modal: HTMLElement, bg: HTMLElement) {
        const index = this.activeModals.findIndex(m => m.modal === modal);
        if (index === -1) return;

        const { opener, onClose } = this.activeModals[index];
        this.activeModals.splice(index, 1);

        modal.classList.remove("open");
        bg.classList.remove("open");
        modal.setAttribute("aria-hidden", "true");
        updateScrollLock();

        if (onClose) onClose();

        if (opener && (opener as HTMLElement).focus) {
            (opener as HTMLElement).focus();
        }
    }

    static closeTop() {
        if (this.activeModals.length === 0) return;
        const top = this.activeModals[this.activeModals.length - 1];
        if (top.persistent) return;
        this.close(top.modal, top.bg);
    }

    static isOpen(modal: HTMLElement) {
        return modal.classList.contains("open");
    }
}

if (typeof document !== "undefined") {
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            ModalManager.closeTop();
        }
    });
}
