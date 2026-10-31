import type { ConvertPathNode } from "../core/FormatHandler/FormatHandler.ts";

/**
 * The one-hop route through the Office engine, for a conversion that must use it.
 *
 * The route finder cannot be trusted to pick it. The engine joins the handler
 * list after it is installed, so its edges carry the largest handler-priority
 * cost, and Word to PDF came out cheaper as Envelope's HTML then
 * svgForeignObject's picture-only PDF. PowerPoint and Excel only reached the
 * engine because nothing else reads them.
 */
export function directOfficePath(input: ConvertPathNode, options: ConvertPathNode[]): ConvertPathNode[] | null {
    const ext = input.format.extension.toLowerCase();
    const office = options.filter(o => o.handler?.name === "libreoffice");
    const reads = office.some(o => o.format.from && o.format.extension.toLowerCase() === ext);
    const pdf = office.find(o => o.format.to && o.format.extension.toLowerCase() === "pdf");
    return reads && pdf ? [input, pdf] : null;
}
