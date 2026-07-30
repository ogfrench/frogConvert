/** Thrown by `checkpoint()` to unwind a PDF edit that was cancelled mid-run. */
export class PdfEditCancelled extends Error {
  constructor() {
    super('PDF edit cancelled');
    this.name = 'PdfEditCancelled';
  }
}

/**
 * Yield to the event loop, then abort if asked to.
 *
 * The yield is load-bearing twice over: it lets the click that sets `aborted`
 * actually be processed (a synchronous loop never gives the event loop a
 * chance to deliver it), and it unfreezes the UI so the spinner animates.
 */
export async function checkpoint(signal?: AbortSignal): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  if (signal?.aborted) throw new PdfEditCancelled();
}
