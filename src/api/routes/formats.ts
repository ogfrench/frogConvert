import type { FormatHandler } from "../../core/FormatHandler/FormatHandler.ts";

export function handleFormats(handlers: FormatHandler[]): Response {
    const formats = [];
    for (const handler of handlers) {
        if (!handler.supportedFormats) continue;
        for (const format of handler.supportedFormats) {
            formats.push({
                name: format.name,
                mime: format.mime,
                extension: format.extension,
                handler: handler.name,
                canRead: format.from,
                canWrite: format.to
            });
        }
    }
    return Response.json(formats);
}
