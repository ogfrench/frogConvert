import { updateScrollLock } from "../store/store.ts";

export class ModalManager {
    private static activeModals: {
        modal: HTMLElement;
        bg: HTMLElement;
        opener: Element | null;
        onClose?: () => void;
        onEscape?: () => void;
        persistent?: boolean;
        onBackdrop?: (e: MouseEvent) => void;
    }[] = [];

    static open(modal: HTMLElement, bg: HTMLElement, onClose?: () => void, persistent = false, onEscape?: () => void) {
        const opener = document.activeElement;

        // Tapping the backdrop dismisses, exactly as Escape does.
        //
        // This used to be Escape only, which is a keyboard affordance and so no
        // affordance at all on a phone. The compress level dialog made that
        // plain: no close button, no Escape key, and tapping outside did
        // nothing, so the only way out was to pick a level - including picking
        // the one you already had, just to leave. Tapping outside a sheet is
        // the ordinary way to dismiss it on touch, and it was the one route the
        // app never wired up.
        //
        // Routed through `closeTop` so backdrop and Escape cannot drift: a
        // modal with a custom `onEscape` (a confirm step, say) gets that same
        // treatment here rather than being torn down behind its own back, and
        // `persistent` still means persistent.
        //
        // The target check matters because callers lay these out both ways -
        // backdrop as a sibling of the modal, and backdrop as its parent. Only
        // a click on the backdrop *itself* counts, so a click on modal content
        // that bubbles through an enclosing backdrop is ignored.
        const onBackdrop = (e: MouseEvent) => {
            if (e.target !== bg) return;
            this.closeTop("backdrop");
        };
        bg.addEventListener("click", onBackdrop);

        this.activeModals.push({ modal, bg, opener, onClose, onEscape, persistent, onBackdrop });

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

        const { opener, onClose, onBackdrop } = this.activeModals[index];
        this.activeModals.splice(index, 1);

        // Paired with the listener added in `open`. Stacked modals share one
        // backdrop element, so this has to remove *this* entry's handler rather
        // than clear listeners on `bg`.
        if (onBackdrop) bg.removeEventListener("click", onBackdrop);

        modal.classList.remove("open");
        bg.classList.remove("open");
        modal.setAttribute("aria-hidden", "true");
        updateScrollLock();

        if (onClose) onClose();

        if (opener && (opener as HTMLElement).focus) {
            (opener as HTMLElement).focus();
        }
    }

    /**
     * Dismiss the top modal, as Escape and a backdrop tap both ask to do.
     *
     * The two are not the same gesture, and `persistent` is where they part.
     *
     * Escape is deliberate: nothing else is bound to that key, so a modal that
     * is persistent *and* carries an `onEscape` is asking for the keystroke to
     * run its handler rather than tear the modal down. That is how a job in
     * flight offers "Escape stops this" - `onEscape` is the cancel, and it has
     * to win over `persistent` or the key would do nothing.
     *
     * A backdrop tap is not deliberate. It is the largest target on a phone,
     * sitting directly around a small dialog, and it is where a thumb lands by
     * accident. Routing it to `onEscape` too - which is what this did when
     * backdrop dismissal was first added - meant a stray tap beside the
     * progress modal silently cancelled a running merge or a long video
     * convert, destroying minutes of work that the user never asked to stop.
     * `persistent` already marks exactly those modals, so the backdrop honours
     * it and does nothing. Stopping stays where it is discoverable and
     * deliberate: the Cancel button, and the key.
     */
    static closeTop(source: "escape" | "backdrop" = "escape") {
        if (this.activeModals.length === 0) return;
        const top = this.activeModals[this.activeModals.length - 1];

        // Read from the live entry, not the opening call: `updateTop` flips
        // both of these while a modal is on screen (the cancel button arrives
        // after the progress popup has opened).
        if (source === "backdrop" && top.persistent) return;

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
        // Not in stack yet - open normally
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
