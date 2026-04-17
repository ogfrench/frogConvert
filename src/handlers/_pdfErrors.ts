/**
 * Re-throw pdfjs/pdf-parse password errors as a user-actionable message.
 * No-op for other exceptions (caller re-throws the original).
 */
export function rethrowIfPasswordProtected(e: unknown, fileName: string): void {
    const err = e as { name?: string; message?: string };
    if (err?.name === "PasswordException" || /password/i.test(String(err?.message ?? ""))) {
        throw new Error(
            `"${fileName}" is password-protected. Decrypt it with Adobe Acrobat or similar, then upload again.`,
        );
    }
}
