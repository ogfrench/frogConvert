import { updateScrollLock } from "../store/store.ts";

export class ModalManager {
    private static activeModals: {
        modal: HTMLElement;
        bg: HTMLElement;
        opener: Element | null;
        onClose?: () => void;
        onEscape?: () => void;
        persistent?: boolean;
    }[] = [];

    static open(modal: HTMLElement, bg: HTMLElement, onClose?: () => void, persistent = false, onEscape?: () => void) {
        const opener = document.activeElement;
        this.activeModals.push({ modal, bg, opener, onClose, onEscape, persistent });

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
        // Use a reverse search in case the same modal element was pushed multiple times
        let index = -1;
        for (let i = this.activeModals.length - 1; i >= 0; i--) {
            if (this.activeModals[i].modal === modal) {
                index = i;
                break;
            }
        }
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
        
        if (top.onEscape) {
            top.onEscape();
            return;
        }

        if (top.persistent) return;
        this.close(top.modal, top.bg);
    }

    static updateTop(metadata: { onEscape?: () => void; persistent?: boolean }) {
        if (this.activeModals.length === 0) return;
        const top = this.activeModals[this.activeModals.length - 1];
        if ("onEscape" in metadata) top.onEscape = metadata.onEscape;
        if (metadata.persistent !== undefined) top.persistent = metadata.persistent;
    }

    static replaceTop(modal: HTMLElement, bg: HTMLElement, onClose?: () => void, persistent = false, onEscape?: () => void) {
        for (let i = this.activeModals.length - 1; i >= 0; i--) {
            if (this.activeModals[i].modal === modal) {
                this.activeModals[i].onClose = onClose;
                this.activeModals[i].onEscape = onEscape;
                this.activeModals[i].persistent = persistent;
                // Move to top if not already there, preserving original opener
                if (i !== this.activeModals.length - 1) {
                    const entry = this.activeModals.splice(i, 1)[0];
                    this.activeModals.push(entry);
                }
                return;
            }
        }
        // Not in stack yet — open normally
        this.open(modal, bg, onClose, persistent, onEscape);
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
