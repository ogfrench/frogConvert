/**
 * What kind of file is this, really?
 *
 * Routing into Ghostscript is done by extension, like everything else in this
 * codebase. This module answers a narrower question the extension cannot: an
 * `.ai` file is *either* a PDF or an EPS depending on which decade it came
 * from, and the two need different flags and different honesty in the UI.
 */

/** How the bytes are actually encoded, whatever the extension claims. */
export type PostScriptFlavour = "pdf" | "postscript" | "unknown";

/** `%PDF-` */
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];
/** `%!` - the start of `%!PS-Adobe`, and of any bare PostScript program. */
const PS_MAGIC = [0x25, 0x21];
/**
 * DOS EPS binary header. The PostScript is wrapped in a container carrying an
 * optional TIFF/WMF preview, so the file does not start with `%!` at all -
 * miss this and a perfectly good EPS looks like an unknown binary.
 */
const EPS_BINARY_MAGIC = [0xc5, 0xd0, 0xd3, 0xc6];

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
    if (bytes.length < magic.length) return false;
    for (let i = 0; i < magic.length; i++) if (bytes[i] !== magic[i]) return false;
    return true;
}

export function detectPostScriptFlavour(bytes: Uint8Array): PostScriptFlavour {
    if (startsWith(bytes, PDF_MAGIC)) return "pdf";
    if (startsWith(bytes, PS_MAGIC) || startsWith(bytes, EPS_BINARY_MAGIC)) return "postscript";
    return "unknown";
}

/**
 * Illustrator has written PDF-compatible `.ai` files since Illustrator 9
 * (2000), so in practice a modern `.ai` *is* a PDF carrying a private
 * Illustrator payload alongside the page content. Ghostscript reads the PDF
 * half perfectly and discards the rest.
 *
 * That makes `AI → PDF` an honest conversion of everything that renders, and a
 * silent loss of everything that made the file editable - layers, live text,
 * effects, artboard metadata. The issue this shipped under asks for that to be
 * "stated honestly wherever it is offered" rather than discovered later, so the
 * copy lives here next to the detection rather than being retyped per surface.
 */
export const AI_FLATTENING_NOTICE =
    "Illustrator files convert through their PDF layer: the artwork comes across intact, " +
    "but layers, editable text and effects are flattened. Keep your .ai as the master.";

/** True when this file needs `-dEPSCrop` - EPS art is sized by its bounding box. */
export function wantsEpsCrop(extension: string, flavour: PostScriptFlavour): boolean {
    if (extension === "eps") return true;
    // An old EPS-based .ai is an EPS in all but name.
    return extension === "ai" && flavour === "postscript";
}
